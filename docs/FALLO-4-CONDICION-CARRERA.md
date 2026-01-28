# FALLO #4: LA CONDICIÓN DE CARRERA

## Descripción del Fallo

**Escenario**: Múltiples usuarios intentan reservar el último asiento disponible simultáneamente.

**Criticidad**: CRITICA

**Por qué es catastrófico**:
- Sobreventa: Vender más asientos de los disponibles
- Inconsistencia de datos: El inventario muestra valores negativos
- Pérdida de confianza: Clientes reciben confirmaciones que luego se cancelan
- Pérdida económica: Reembolsos, compensaciones

**El problema técnico**:
```javascript
const asientos = await getAsientos(eventoId);

if (asientos >= cantidadSolicitada) {
  await reservar(eventoId, cantidadSolicitada);
}
```

Entre `getAsientos()` y `reservar()`, otro proceso puede modificar el inventario.

---

## Patrón de Resiliencia Aplicado

### Distributed Lock (Redlock)

**Propósito**: Garantizar que solo un proceso puede modificar el inventario a la vez.

**Implementación**:
```javascript
const Redlock = require('redlock');
const redlock = new Redlock([redisClient], {
  driftFactor: 0.01,
  retryCount: 10,
  retryDelay: 200,
  retryJitter: 200
});

async function crearReservaSegura(eventoId, asientos, usuario) {
  const lockKey = `lock:evento:${eventoId}`;
  const lockTTL = 10000;
  let lock = null;
  
  try {
    lock = await redlock.acquire([lockKey], lockTTL);
    
    const inventario = await consultarInventario(eventoId);
    
    if (inventario.asientosDisponibles < asientos) {
      throw new Error('Asientos insuficientes');
    }
    
    await reservarAsientos(eventoId, asientos);
    await procesarPago(usuario, asientos);
    await confirmarReserva(eventoId, usuario);
    
    await lock.release();
    
    return { exito: true };
  } catch (error) {
    if (lock) {
      try {
        await lock.release();
      } catch (releaseError) {
        logger.error('Error liberando lock:', releaseError);
      }
    }
    throw error;
  }
}
```

---

## Cómo Funciona el Sistema con Este Fallo

### Sin Distributed Lock (FALLO)

```
Tiempo | Usuario A                    | Usuario B
-------|------------------------------|--------------------------------
T0     | GET /inventario/evento-4     | GET /inventario/evento-4
       | → {asientos: 1}              | → {asientos: 1}
T1     | Verificar: 1 >= 1            | Verificar: 1 >= 1
T2     | POST /inventario/.../reservar| POST /inventario/.../reservar
       | → asientos = 0               | → asientos = -1 SOBREVENTA
T3     | Pagar $50                    | Pagar $50
T4     | Reserva confirmada           | Reserva confirmada

RESULTADO: 2 reservas para 1 asiento = INCONSISTENCIA
```

### Con Distributed Lock (CORRECTO)

```
Tiempo | Usuario A                    | Usuario B
-------|------------------------------|--------------------------------
T0     | Adquirir lock(evento-4)      | Adquirir lock(evento-4) ESPERA
T1     | GET /inventario/evento-4     |
       | → {asientos: 1}              |
T2     | Verificar: 1 >= 1            |
T3     | POST /inventario/.../reservar|
       | → asientos = 0               |
T4     | Pagar $50                    |
T5     | Reserva confirmada           |
T6     | Liberar lock                 | Lock adquirido
T7     |                              | GET /inventario/evento-4
       |                              | → {asientos: 0}
T8     |                              | Verificar: 0 >= 1 FALLA
T9     |                              | Liberar lock
       |                              | Error 409: Asientos no disponibles

RESULTADO: 1 reserva exitosa, 1 rechazada correctamente
```

---

## Demostración del Fallo

### Ejecutar Demo

```bash
npm run demo:condicion-carrera
```

### Simular Manualmente

```javascript
const axios = require('axios');

async function intentarReserva(nombre) {
  try {
    const response = await axios.post('http://localhost:3000/api/reservas', {
      eventoId: 'evento-4',
      asientos: 1,
      usuario: `${nombre}@example.com`,
      metodoPago: 'tarjeta'
    });
    console.log(`${nombre} GANO: Reserva ${response.data.reserva.id}`);
  } catch (error) {
    console.log(`${nombre} PERDIO: ${error.response?.data?.error}`);
  }
}

Promise.all([
  intentarReserva('Alice'),
  intentarReserva('Bob'),
  intentarReserva('Charlie'),
  intentarReserva('Diana'),
  intentarReserva('Eve')
]);
```

### Qué Observar

1. **Logs del Servicio de Reservas**:
   ```
   [Alice] Adquiriendo lock para evento-4...
   [Alice] Lock adquirido
   [Alice] Verificando disponibilidad: 1 asiento
   [Alice] Reservando 1 asiento...
   [Alice] Procesando pago...
   [Alice] Reserva confirmada
   [Alice] Lock liberado
   
   [Bob] Adquiriendo lock para evento-4...
   [Bob] Lock adquirido
   [Bob] Verificando disponibilidad: 0 asientos
   [Bob] Asientos insuficientes
   [Bob] Lock liberado
   ```

2. **Resultado en consola**:
   ```
   Alice GANO: Reserva abc-123
   Bob PERDIO: Asientos no disponibles
   Charlie PERDIO: Asientos no disponibles
   Diana PERDIO: Asientos no disponibles
   Eve PERDIO: Asientos no disponibles
   ```

3. **Verificar integridad del inventario**:
   ```bash
   curl http://localhost:3002/inventario/evento-4
   ```
   ```json
   {
     "eventoId": "evento-4",
     "asientosDisponibles": 0,
     "disponible": false
   }
   ```

---

## Análisis de Resultados

### Escenario: 5 usuarios, 1 asiento

| Métrica | Sin Lock | Con Distributed Lock |
|---------|----------|----------------------|
| **Reservas exitosas** | 5 | 1 |
| **Asientos finales** | -4 | 0 |
| **Inconsistencias** | Sí | No |
| **Usuarios decepcionados** | 0 inicialmente, 4 después | 4 |
| **Pérdida económica** | Alta | Ninguna |

*4 usuarios descubren después que no tienen asiento aunque pagaron.

### Orden de Ejecución

**Sin lock** (no determinista):
```
Usuario A y B llegan simultáneamente → AMBOS ven 1 asiento → AMBOS reservan
Resultado: IMPREDECIBLE, depende de timing exacto
```

**Con lock** (determinista):
```
Usuarios A, B, C, D, E llegan simultáneamente
→ Se ordenan automáticamente
→ A procesa primero, B espera, C espera, D espera, E espera
→ Solo A tiene éxito
Resultado: PREDECIBLE y CORRECTO
```

---

## Conceptos Clave Demostrados

### 1. Race Condition (Condición de Carrera)

**Definición**: Comportamiento anómalo cuando múltiples procesos acceden a recursos compartidos sin sincronización adecuada.

**Ejemplo clásico**:
```javascript
let saldo = 100;

function retirar(cantidad) {
  if (saldo >= cantidad) {
    saldo = saldo - cantidad;
  }
}

retirar(80);
retirar(80);

```

Ambos pasan el check, ambos restan. Resultado: saldo = -60

**Solución con lock**:
```javascript
async function retirarSeguro(cantidad) {
  const lock = await adquirirLock('saldo');
  try {
    if (saldo >= cantidad) {
      saldo -= cantidad;
    }
  } finally {
    await lock.release();
  }
}
```

### 2. Distributed Lock (Redlock Algorithm)

**Problema**: En sistemas distribuidos, locks deben funcionar entre múltiples servidores.

**Algoritmo Redlock**:
1. Obtener tiempo actual
2. Intentar adquirir lock en N/2 + 1 instancias de Redis
3. Si se adquirió en mayoría Y tiempo < TTL → Lock adquirido
4. Si no → Liberar locks adquiridos y reintentar

**Propiedades garantizadas**:
- **Safety**: A lo sumo un cliente tiene el lock en cualquier momento
- **Liveness**: Deadlocks imposibles (locks expiran con TTL)
- **Fault tolerance**: Funciona aunque algunos Redis fallen

### 3. ACID en Sistemas Distribuidos

**Problema**: Mantener ACID sin una base de datos transaccional.

**Solución SAGA Pattern**:
```
Transacción = Secuencia de pasos + Compensaciones

Paso 1: Reservar asientos
  Compensación 1: Liberar asientos

Paso 2: Procesar pago
  Compensación 2: Reembolsar pago

Paso 3: Enviar confirmación
  Compensación 3: Enviar cancelación

Si algún paso falla:
→ Ejecutar compensaciones en orden inverso
→ Sistema vuelve a estado consistente
```

### 4. Check-Then-Act Anti-Pattern

**Anti-pattern** (MAL):
```javascript
if (inventario.asientos > 0) {
  inventario.asientos--;
}
```

**Correcto** (operación atómica):
```javascript
const updated = await db.update({
  where: { id: eventoId, asientos: { gt: 0 } },
  data: { asientos: { decrement: 1 } }
});
```

---

## Código Clave

### Implementación Completa del Lock

```javascript
async function crearReservaConLock(eventoId, asientos, usuario) {
  const lockKey = `lock:evento:${eventoId}`;
  const lockTTL = 10000;
  let lock = null;
  
  try {
    logger.info(`Intentando adquirir lock para ${eventoId}...`);
    lock = await redlock.acquire([lockKey], lockTTL);
    logger.info(`Lock adquirido`);
    
    const resultado = await ejecutarReservaCritica(eventoId, asientos, usuario);
    
    await lock.release();
    logger.info(`Lock liberado`);
    
    return resultado;
  } catch (error) {
    if (error.message.includes('lock')) {
      logger.warn(`No se pudo adquirir lock (otra reserva en proceso)`);
      throw new Error('Hay otra reserva en proceso para este evento. Intenta nuevamente.');
    }
    
    if (lock) {
      try {
        await lock.release();
      } catch (releaseError) {
        logger.error(`Error liberando lock: ${releaseError.message}`);
      }
    }
    
    throw error;
  }
}

redlock.on('error', (error) => {
  logger.error(`Redlock error: ${error.message}`);
});
```

### Operación Atómica con Optimistic Locking

```javascript
async function reservarConOptimisticLock(eventoId, cantidad) {
  const maxRetries = 3;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const evento = await db.findOne({ where: { id: eventoId } });
    
    if (evento.asientos < cantidad) {
      throw new Error('Asientos insuficientes');
    }
    
    const updated = await db.update({
      where: {
        id: eventoId,
        version: evento.version
      },
      data: {
        asientos: evento.asientos - cantidad,
        version: evento.version + 1
      }
    });
    
    if (updated) {
      return { success: true };
    }
    
    logger.warn(`Conflicto de versión en intento ${attempt + 1}. Reintentando...`);
    await sleep(100 * Math.pow(2, attempt));
  }
  
  throw new Error('No se pudo completar la reserva después de varios intentos');
}
```

---

## Configuración Recomendada

```javascript
{
  redlock: {
    driftFactor: 0.01,
    retryCount: 10,
    retryDelay: 200,
    retryJitter: 200,
    ttl: 10000,
    automaticExtensionThreshold: 500
  },
  
  redis: {
    instances: [
      { host: 'redis-1', port: 6379 },
      { host: 'redis-2', port: 6379 },
      { host: 'redis-3', port: 6379 }
    ],
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    connectTimeout: 10000
  },
  
  compensation: {
    enabled: true,
    maxRetries: 3,
    retryDelay: 1000,
    dlqEnabled: true,
    dlqTopic: 'failed-compensations'
  }
}
```

---

## Casos Edge y Soluciones

### 1. Lock Deadlock

**Problema**: Proceso A tiene lock, falla, nunca lo libera → todos esperan indefinidamente.

**Solución**: TTL automático
```javascript
lock = await redlock.acquire([lockKey], 10000);
```

### 2. Lock Starvation

**Problema**: Proceso A siempre adquiere el lock, B nunca puede.

**Solución**: Fair queue + jitter
```javascript
retryJitter: 200
```

### 3. Split Brain (Redis)

**Problema**: Dos instancias de Redis piensan que tienen el lock.

**Solución**: Algoritmo Redlock (requiere mayoría)
```javascript
// Redlock requiere adquirir lock en N/2 + 1 instancias
// Con 3 Redis: necesita 2 para garantizar exclusión mutua
```

### 4. Clock Drift

**Problema**: Relojes desincronizados entre servidores.

**Solución**: Drift factor
```javascript
driftFactor: 0.01
```

---

## Checklist de Implementación

- [x] Distributed lock (Redlock) configurado
- [x] Operaciones atómicas en Redis (Lua scripts)
- [x] Compensating transactions implementadas
- [x] TTL configurado adecuadamente
- [x] Manejo de errores de lock
- [x] Logging detallado de locks
- [x] Métricas de contención de locks
- [x] Tests de concurrencia
- [x] Dead letter queue para compensaciones fallidas
- [ ] Optimistic locking (alternativa)
- [ ] Distributed tracing
- [ ] Load testing de race conditions

---

## Conclusión

La **Condición de Carrera** es el fallo más peligroso porque causa **inconsistencia de datos**:

**Sin locks**:
```
5 usuarios × 1 asiento = 5 reservas = -4 inventario
→ Sobreventa
→ Inconsistencia de datos
→ Pérdida de dinero
→ Clientes enojados
```

**Con distributed locks**:
```
5 usuarios × 1 asiento = 1 reserva exitosa, 4 rechazadas
→ Sin sobreventa
→ Datos consistentes
→ Sin pérdidas
→ 4 usuarios decepcionados pero sistema íntegro
```

**Patrones aplicados**:
1. Distributed Lock: Exclusión mutua en sistemas distribuidos
2. Atomic Operations: Operaciones indivisibles
3. SAGA Pattern: Transacciones distribuidas con compensación
4. Optimistic Locking: Control de concurrencia

**Lección fundamental**:
> En sistemas distribuidos, la **consistencia de datos** es más importante que la **disponibilidad**. Es preferible rechazar una reserva que permitir sobreventa.

**Resultado**: Sistema que mantiene **integridad de datos** incluso bajo alta concurrencia.
