# FALLO #2: LA PASARELA DE PAGOS LENTA

## Descripción del Fallo

**Escenario**: El servicio de pagos externo responde extremadamente lento (> 20 segundos).

**Criticidad**: ALTA

**Por qué es problemático**:
- Los usuarios abandonan después de 3-5 segundos de espera
- Los timeouts en el navegador causan reintentos duplicados
- Los recursos del servidor se agotan esperando respuestas
- El sistema puede saturarse y caer completamente

**Sin tolerancia a fallos**, este fallo causaría:
- Experiencia de usuario pésima (esperas de 20+ segundos)
- Posibles cargos duplicados (reintentos)
- Saturación de recursos del servidor
- Caída en cascada de todo el sistema

---

## Patrón de Resiliencia Aplicado

### Timeout Agresivo + Async Processing

**Propósito**: No bloquear al usuario esperando respuestas lentas.

**Implementación**:
```javascript
const PAYMENT_TIMEOUT = 5000;

async function procesarPago(reservaId, monto, metodoPago) {
  try {
    const pagoPromise = pasarelaPagos.cobrar({
      monto,
      metodoPago,
      referencia: reservaId
    });
    
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), PAYMENT_TIMEOUT)
    );
    
    const resultado = await Promise.race([pagoPromise, timeout]);
    
    return {
      estado: 'completado',
      transaccionId: resultado.id
    };
  } catch (error) {
    if (error.message === 'Timeout') {
      await registrarPagoPendiente(reservaId, monto);
      
      return {
        estado: 'pendiente',
        mensaje: 'Pago en proceso. Recibirás confirmación por email.'
      };
    }
    throw error;
  }
}
```

**Procesamiento Asíncrono**:
```javascript
async function verificarPagosPendientes() {
  const pendientes = await obtenerPagosPendientes();
  
  for (const pago of pendientes) {
    try {
      const estado = await pasarelaPagos.consultarEstado(pago.id);
      
      if (estado === 'aprobado') {
        await confirmarReserva(pago.reservaId);
        await enviarConfirmacion(pago.usuario);
      } else if (estado === 'rechazado') {
        await cancelarReserva(pago.reservaId);
        await enviarNotificacionRechazo(pago.usuario);
      }
    } catch (error) {
      logger.error(`Error verificando pago ${pago.id}:`, error);
    }
  }
}

setInterval(verificarPagosPendientes, 30000);
```

---

## Cómo Funciona

### Escenario: Pasarela Lenta

```
Tiempo | Usuario                         | Sistema
-------|--------------------------------|-------------------
T0     | Click "Pagar"                  | Inicia transacción
T1     | Loading...                     | Timeout 5s activado
T5     | [TIMEOUT]                      | Marca como PENDIENTE
T5.1   | "Pago en proceso..."           | Libera recursos
T5.2   | "Recibirás email"              | Retorna al usuario
T30    |                                | Tarea verifica estado
T31    |                                | Pago COMPLETADO
T32    | Email: "Pago confirmado"       | Confirma reserva
```

### Escenario: Pasarela Normal

```
Tiempo | Usuario                         | Sistema
-------|--------------------------------|-------------------
T0     | Click "Pagar"                  | Inicia transacción
T1     | Loading...                     | Timeout 5s activado
T2     | [SUCCESS]                      | Pago completado
T2.1   | "Pago exitoso"                 | Confirma reserva
T2.2   | Email: "Reserva confirmada"    | Envía confirmación
```

---

## Demostración del Fallo

### Ejecutar Demo

```bash
npm run demo:pasarela-lenta
```

### Simular Manualmente

```javascript
const axios = require('axios');

async function testPagoLento() {
  console.log('Iniciando pago...');
  const inicio = Date.now();
  
  try {
    const response = await axios.post('http://localhost:3000/api/reservas', {
      eventoId: 'evento-2',
      asientos: 1,
      usuario: 'test@example.com',
      metodoPago: 'tarjeta'
    });
    
    const duracion = Date.now() - inicio;
    console.log(`Respuesta en ${duracion}ms:`, response.data);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testPagoLento();
```

### Qué Observar

1. **Respuesta rápida al usuario** (< 5 segundos):
   ```json
   {
     "reserva": {
       "id": "res-123",
       "estado": "pendiente",
       "mensaje": "Pago en proceso. Recibirás confirmación por email."
     }
   }
   ```

2. **Logs del servidor**:
   ```
   INFO: Procesando pago para reserva res-123
   WARN: Timeout en pasarela de pagos (5s)
   INFO: Pago marcado como PENDIENTE
   INFO: Respuesta enviada al usuario
   INFO: [30s después] Verificando pagos pendientes...
   INFO: Pago res-123 COMPLETADO
   INFO: Confirmación enviada a test@example.com
   ```

3. **Email al usuario** (30 segundos después):
   ```
   Asunto: Confirmación de Pago
   
   Tu pago ha sido procesado exitosamente.
   Reserva: res-123
   Monto: $50
   Estado: CONFIRMADO
   ```

---

## Comportamiento del Sistema

### Sin Timeout (FALLO)

```
Usuario espera 20+ segundos
→ Usuario abandona
→ Servidor bloqueado esperando respuesta
→ Recursos agotados
→ Sistema saturado
```

### Con Timeout + Async (CORRECTO)

```
Usuario espera máximo 5 segundos
→ Recibe confirmación de "pago pendiente"
→ Servidor libera recursos inmediatamente
→ Tarea background verifica estado real
→ Usuario recibe confirmación por email
→ Experiencia aceptable
```

---

## Conceptos Clave

### 1. Timeout Pattern

Evitar esperas indefinidas:
```javascript
const MAX_WAIT = 5000;

const result = await Promise.race([
  operacionLenta(),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Timeout')), MAX_WAIT)
  )
]);
```

### 2. Async Processing

Procesar en background:
```javascript
async function procesarEnBackground(tarea) {
  await guardarEnCola(tarea);
  
  return {
    estado: 'procesando',
    mensaje: 'Recibirás notificación cuando termine'
  };
}
```

### 3. Eventual Consistency

Aceptar que algunos datos no están inmediatamente sincronizados:
```
T0: Pago PENDIENTE (usuario ve este estado)
T30: Pago COMPLETADO (estado real)
→ Consistencia eventual (30s después)
```

### 4. Graceful Degradation

Proporcionar servicio reducido en lugar de fallar:
```
IDEAL: Confirmación inmediata
DEGRADADO: Confirmación por email (30s después)
FALLIDO: Error 504 Gateway Timeout
```

---

## Código Clave

### Timeout con Promise.race

```javascript
async function conTimeout(promise, timeout) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Operation timeout')), timeout)
  );
  
  return Promise.race([promise, timeoutPromise]);
}

const result = await conTimeout(
  pasarelaPagos.cobrar(data),
  5000
);
```

### Worker Background

```javascript
class PaymentWorker {
  constructor() {
    this.interval = null;
  }
  
  start() {
    this.interval = setInterval(async () => {
      await this.verificarPendientes();
    }, 30000);
  }
  
  async verificarPendientes() {
    const pendientes = await db.pagos.findAll({
      where: { estado: 'pendiente' }
    });
    
    for (const pago of pendientes) {
      await this.verificarPago(pago);
    }
  }
  
  async verificarPago(pago) {
    const estado = await pasarela.consultarEstado(pago.transaccionId);
    
    if (estado === 'aprobado') {
      await this.completarPago(pago);
    } else if (estado === 'rechazado') {
      await this.cancelarPago(pago);
    }
  }
}

const worker = new PaymentWorker();
worker.start();
```

---

## Métricas y Monitoreo

### Indicadores Clave

| Métrica | Valor Normal | Alerta |
|---------|-------------|--------|
| Latencia p95 pagos | < 2s | > 5s |
| Tasa timeouts | < 1% | > 5% |
| Pagos pendientes | < 10 | > 50 |
| Tiempo resolución | < 60s | > 300s |

### Dashboards

1. **Latencia de pagos**: Histograma de tiempos de respuesta
2. **Tasa de timeouts**: % de pagos que exceden 5s
3. **Cola de pendientes**: Número de pagos sin confirmar
4. **Tasa de éxito eventual**: % de pagos pendientes que se completan

### Alertas

```yaml
alerts:
  - name: HighPaymentLatency
    condition: payment_latency_p95 > 5s
    duration: 2m
    severity: warning
    
  - name: TooManyPendingPayments
    condition: pending_payments_count > 50
    duration: 5m
    severity: critical
    message: "Pasarela de pagos puede estar caída"
```

---

## Configuración Recomendada

```javascript
{
  payments: {
    timeout: 5000,
    
    retry: {
      maxAttempts: 3,
      backoff: 'exponential',
      initialDelay: 1000
    },
    
    pendingVerification: {
      enabled: true,
      interval: 30000,
      maxAttempts: 10,
      expireAfter: 86400000
    },
    
    notifications: {
      sendOnPending: true,
      sendOnComplete: true,
      sendOnFailed: true
    }
  }
}
```

---

## Checklist de Implementación

- [x] Timeout configurado (5 segundos)
- [x] Procesamiento asíncrono
- [x] Worker de verificación background
- [x] Notificaciones por email
- [x] Logging de estados
- [x] Métricas de latencia
- [x] Alertas de timeouts
- [x] Manejo de estados pendientes
- [ ] Retry automático de pagos fallidos
- [ ] Dashboard de monitoreo
- [ ] Tests de carga

---

## Conclusión

La **Pasarela Lenta** demuestra cómo manejar servicios externos lentos sin afectar la experiencia del usuario.

**Sin timeout**:
```
Usuario espera 20s → Frustración → Abandono
→ Pérdida de ventas
```

**Con timeout + async**:
```
Usuario espera 5s → Confirmación pendiente → Email (30s)
→ Experiencia degradada pero aceptable
→ Venta completada
```

**Patrones aplicados**:
1. Timeout: Límite de espera
2. Async Processing: Procesamiento en background
3. Eventual Consistency: Datos sincronizados eventualmente
4. Graceful Degradation: Servicio reducido pero funcional

**Lección fundamental**:
> Es mejor dar una respuesta parcial rápida que una respuesta perfecta tarde.

**Resultado**: Sistema que mantiene UX aceptable aunque servicios externos sean lentos.
