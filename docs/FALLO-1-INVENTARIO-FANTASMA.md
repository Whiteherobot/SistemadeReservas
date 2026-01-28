# FALLO #1: EL INVENTARIO FANTASMA

## Descripción del Fallo

**Escenario**: El servicio de inventario sufre una caída total y deja de responder a peticiones.

**Criticidad**: ALTA

El servicio de inventario es fundamental para:
- Validar disponibilidad de asientos antes de crear reservas
- Prevenir sobreventa
- Sincronizar el estado entre reservas y stock disponible

**Sin tolerancia a fallos**, este fallo causaría:
- Bloqueo total del sistema de reservas
- Timeouts en todas las peticiones
- Imposibilidad de crear nuevas reservas
- Caída en cascada de otros servicios
- Experiencia de usuario muy degradada

---

## Patrones de Resiliencia Aplicados

### 1. Circuit Breaker

**Propósito**: Detectar cuando el servicio está caído y evitar llamadas innecesarias que fallarán.

**Implementación**:
```javascript
const inventarioClient = createResilientHttpClient(INVENTARIO_URL, {
  timeout: 3000,
  retries: 2,
  breakerOptions: {
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 15000,
    volumeThreshold: 3
  }
});
```

**Estados del Circuit Breaker**:
1. **CERRADO** (normal): Todas las peticiones pasan al servicio
2. **ABIERTO** (fallo detectado): Peticiones fallan inmediatamente
3. **HALF-OPEN** (probando): Permite algunas peticiones para probar recuperación

### 2. Fallback a Cache Local

**Propósito**: Proporcionar datos (aunque potencialmente obsoletos) cuando el servicio no está disponible.

**Implementación**:
```javascript
const inventarioCache = new Map();
const CACHE_TTL = 60000;

async function consultarInventario(eventoId) {
  try {
    const response = await inventarioClient.get(`/inventario/${eventoId}`);
    inventarioCache.set(eventoId, {
      data: response.data,
      timestamp: Date.now()
    });
    return response.data;
  } catch (error) {
    const cached = inventarioCache.get(eventoId);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      logger.warn(`Usando inventario desde CACHE`);
      return { ...cached.data, fromCache: true };
    }
    throw new Error('Servicio de inventario no disponible');
  }
}
```

### 3. Retry con Backoff Exponencial

**Propósito**: Reintentar peticiones fallidas con delays incrementales.

**Configuración**:
```javascript
{
  maxRetries: 2,
  initialDelay: 1000,
  factor: 2,
  maxDelay: 10000
}
```

**Secuencia de reintentos**:
- Intento 1: Inmediato
- Intento 2: Espera 1 segundo
- Intento 3: Espera 2 segundos

---

## Cómo Funciona el Sistema con Este Fallo

### Flujo Normal (Sin Fallo)

```
Usuario → API Gateway → Servicio Reservas → Servicio Inventario (success)
                                          ← Disponibilidad: 100 asientos
                                          → Reservar 2 asientos (success)
                                          ← Confirmación: 98 restantes
         ← Reserva exitosa
```

### Flujo con Fallo (Inventario Caído)

```
Usuario → API Gateway → Servicio Reservas → Servicio Inventario (timeout)
                                          ↓
                                        Retry 1 (timeout)
                                          ↓
                                        Retry 2 (timeout)
                                          ↓
                                    Circuit Breaker ABRE
                                          ↓
                                    Fallback → Cache Local
                                          ↓
                                    Inventario (60s antiguo)
                                          ↓
         ← Reserva con advertencia: "Datos pueden no estar actualizados"
```

### Recuperación Automática

```
Circuit Breaker ABIERTO (15 segundos)
         ↓
Circuit Breaker → HALF-OPEN (prueba)
         ↓
Petición de prueba → Servicio Inventario (recuperado)
         ↓
Circuit Breaker → CERRADO
         ↓
Sistema completamente funcional
```

---

## Demostración del Fallo

### Pasos para Forzar el Fallo

**Opción 1: Usando endpoint de administración**
```bash
curl -X POST http://localhost:3002/admin/simular-fallo \
  -H "Content-Type: application/json" \
  -d '{"activar": true}'
```

**Opción 2: Detener contenedor Docker**
```bash
docker-compose stop inventario
docker-compose ps
```

**Opción 3: Simular pérdida de red**
```bash
netsh advfirewall firewall add rule name="Block Inventario" dir=in action=block protocol=TCP localport=3002
```

### Ejecutar Demo Automatizada

```bash
npm run demo:inventario-caida
```

### Qué Observar

1. **Logs del API Gateway**:
   ```
   WARNING: CIRCUIT BREAKER ABIERTO: http-http://inventario:3002
   PROTECTION: FALLBACK ACTIVADO: Usando respuesta alternativa
   ```

2. **Logs del Servicio de Reservas**:
   ```
   PROTECTION: Usando inventario desde CACHE (45s antiguo)
   WARNING: Datos pueden estar desactualizados
   ```

3. **Respuesta al usuario**:
   ```json
   {
     "error": "El servicio de inventario no está disponible temporalmente",
     "fallback": "Intenta nuevamente en unos momentos"
   }
   ```

4. **Métricas del Circuit Breaker**:
   ```bash
   curl http://localhost:3000/metrics
   ```
   ```json
   {
     "circuitBreaker": {
       "status": "OPEN",
       "stats": {
         "failures": 5,
         "successes": 0,
         "timeouts": 5
       }
     }
   }
   ```

---

## Comportamiento del Sistema

### ANTES del Fallo
- All requests successful
- Real-time data
- Low latency (~50ms)

### DURANTE el Fallo (Primeros 5-10 segundos)
- Timeouts (3 segundos cada uno)
- Automatic retries
- High latency due to timeouts

### DURANTE el Fallo (Después de 10 segundos)
- Circuit Breaker ABIERTO
- Fallback to cache activated
- Potentially stale data
- Low latency again (~10ms desde cache)

### DESPUÉS de la Recuperación
- Circuit Breaker intenta cerrar (15s)
- Peticiones de prueba exitosas
- Circuit Breaker CERRADO
- Sistema completamente funcional

---

## Degradación Controlada

El sistema NO colapsa, sino que se degrada de forma controlada:

| Función | Normal | Con Fallo |
|---------|--------|-----------|
| Crear reservas | Success | Warning (con cache) |
| Ver disponibilidad | Success | Warning (puede estar desactualizado) |
| Procesar pagos | Success | Success |
| Enviar notificaciones | Success | Success |
| Cancelar reservas | Success | Warning |

**Mensaje al usuario**:
> "El sistema está experimentando problemas de conectividad. La información mostrada puede no estar completamente actualizada. Por favor, verifica tu reserva después de completar la compra."

---

## Conceptos Clave Demostrados

### 1. Fail Fast
- No esperar indefinidamente por un servicio caído
- Timeout de 3 segundos (vs 30+ segundos por defecto)
- Reduce la frustración del usuario

### 2. Isolación de Fallos
- El fallo del inventario NO afecta a pagos ni notificaciones
- Otros servicios continúan funcionando normalmente

### 3. Cache como Resiliencia
- Datos obsoletos son mejores que ningún dato
- TTL configurable según criticidad del negocio

### 4. Recuperación Automática
- No requiere intervención manual
- El sistema se auto-recupera cuando el servicio vuelve

---

## Código Clave

### Circuit Breaker con Fallback

```javascript
const breaker = createCircuitBreaker(
  async (config) => {
    return await retryWithBackoff(
      () => client.request(config),
      { maxRetries: 2 }
    );
  },
  {
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 15000
  }
);

breaker.fallback(() => {
  logger.warn('FALLBACK activado');
  return { data: { fallback: true, cache: true } };
});
```

### Eventos del Circuit Breaker

```javascript
breaker.on('open', () => {
  logger.warn('CIRCUIT BREAKER ABIERTO');
});

breaker.on('halfOpen', () => {
  logger.info('CIRCUIT BREAKER HALF-OPEN');
});

breaker.on('close', () => {
  logger.info('CIRCUIT BREAKER CERRADO');
});
```

---

## Métricas y Monitoreo

### Métricas Importantes

1. **Tasa de fallos**: % de peticiones que fallan
2. **Estado del circuit breaker**: Open/Closed/Half-Open
3. **Cache hit rate**: % de peticiones servidas desde cache
4. **Latencia p95/p99**: Percentiles de latencia
5. **Edad del cache**: Antigüedad de los datos en cache

### Alertas Recomendadas

```yaml
alerts:
  - name: CircuitBreakerOpen
    condition: circuit_breaker_status == "OPEN"
    duration: 2m
    severity: warning
    
  - name: CacheHitRateHigh
    condition: cache_hit_rate > 80%
    duration: 5m
    severity: warning
    message: "Servicio de inventario puede estar caído"
```

---

## Configuración Recomendada para Producción

```javascript
{
  timeout: 5000,
  errorThresholdPercentage: 30,
  resetTimeout: 30000,
  volumeThreshold: 10,
  
  maxRetries: 3,
  initialDelay: 500,
  maxDelay: 5000,
  
  cacheTTL: 300000,
  staleTTL: 900000,
  
  enableMetrics: true,
  metricsInterval: 10000
}
```

---

## Checklist de Implementación

- [x] Circuit Breaker configurado
- [x] Fallback a cache implementado
- [x] Retry con backoff exponencial
- [x] Logging de eventos importantes
- [x] Timeout configurado apropiadamente
- [x] Métricas expuestas
- [x] Mensajes de error informativos al usuario
- [x] Recuperación automática
- [x] Tests de integración
- [x] Documentación

---

## Conclusión

Este patrón demuestra cómo un sistema puede continuar operando (aunque de forma degradada) ante la caída de un servicio crítico. En lugar de fallar completamente, el sistema:

1. Detecta el fallo rápidamente (Circuit Breaker)
2. Evita saturar el servicio caído (Fail Fast)
3. Proporciona una experiencia degradada pero funcional (Fallback)
4. Se recupera automáticamente (Auto-healing)
5. Informa al usuario de la situación (Transparencia)

**Resultado**: Disponibilidad del 80-90% durante el fallo vs 0% sin estos patrones.
