# FALLO #3: EL DILUVIO DE PETICIONES

## Descripción del Fallo

**Escenario**: Liberación masiva de entradas para un evento muy popular genera miles de peticiones simultáneas.

**Criticidad**: CRITICA

**Por qué es catastrófico**:
- 10,000+ usuarios intentando reservar al mismo tiempo
- El servidor se satura procesando todas las peticiones
- Los tiempos de respuesta se disparan a 30+ segundos
- El servidor puede quedarse sin memoria y crashear
- Ningún usuario logra completar su reserva

**Sin tolerancia a fallos**:
- Sistema completamente inutilizable
- Pérdida total de ingresos durante el evento
- Daño reputacional severo

---

## Patrones de Resiliencia Aplicados

### 1. Rate Limiting

**Propósito**: Limitar el número de peticiones que un usuario puede hacer.

**Implementación**:
```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Demasiadas peticiones. Intenta en 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);
```

### 2. Request Queuing + Bulkhead

**Propósito**: Procesar peticiones en cola controlada en lugar de todas a la vez.

**Implementación**:
```javascript
const PQueue = require('p-queue');

const reservasQueue = new PQueue({
  concurrency: 50,
  timeout: 30000,
  throwOnTimeout: true
});

app.post('/api/reservas', async (req, res) => {
  try {
    const result = await reservasQueue.add(async () => {
      return await procesarReserva(req.body);
    });
    
    res.json(result);
  } catch (error) {
    if (error.name === 'TimeoutError') {
      res.status(503).json({
        error: 'Sistema saturado. Por favor intenta nuevamente.'
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});
```

### 3. Load Shedding

**Propósito**: Rechazar peticiones cuando el sistema está sobrecargado.

**Implementación**:
```javascript
const toobusy = require('toobusy-js');

toobusy.maxLag(70);

app.use((req, res, next) => {
  if (toobusy()) {
    res.status(503).json({
      error: 'Servidor sobrecargado. Intenta en unos momentos.'
    });
  } else {
    next();
  }
});
```

---

## Cómo Funciona

### Sin Protección (FALLO)

```
10,000 usuarios
    ↓
Todas las peticiones procesadas simultáneamente
    ↓
CPU: 100%
Memoria: 95%
Latencia: 30+ segundos
    ↓
Servidor crashea
    ↓
0 reservas completadas
```

### Con Rate Limiting + Queue (CORRECTO)

```
10,000 usuarios
    ↓
Rate Limiter: 100 peticiones/15min por usuario
    ↓
Queue: Máximo 50 procesando simultáneamente
    ↓
CPU: 60%
Memoria: 40%
Latencia: 2-5 segundos
    ↓
Servidor estable
    ↓
Primeros 1,000 usuarios completan reservas
Resto espera en cola o recibe "intenta más tarde"
```

---

## Demostración del Fallo

### Ejecutar Demo

```bash
npm run demo:diluvio-peticiones
```

### Simular Manualmente

```javascript
const axios = require('axios');

async function simularDiluvio() {
  const peticiones = [];
  
  for (let i = 0; i < 1000; i++) {
    peticiones.push(
      axios.post('http://localhost:3000/api/reservas', {
        eventoId: 'evento-3',
        asientos: 1,
        usuario: `user${i}@example.com`,
        metodoPago: 'tarjeta'
      }).catch(error => ({
        error: true,
        status: error.response?.status,
        message: error.response?.data?.error
      }))
    );
  }
  
  const resultados = await Promise.allSettled(peticiones);
  
  const exitosas = resultados.filter(r => r.status === 'fulfilled' && !r.value.error).length;
  const rechazadas = resultados.filter(r => r.value?.status === 429).length;
  const fallidas = resultados.filter(r => r.value?.status === 503).length;
  
  console.log(`Exitosas: ${exitosas}`);
  console.log(`Rechazadas por rate limit: ${rechazadas}`);
  console.log(`Rechazadas por sobrecarga: ${fallidas}`);
}

simularDiluvio();
```

### Qué Observar

1. **Respuestas del servidor**:
   ```json
   {
     "error": "Demasiadas peticiones. Intenta en 15 minutos."
   }
   ```
   Status: 429 Too Many Requests

2. **Logs del servidor**:
   ```
   INFO: Cola de reservas: 50/50 (saturada)
   WARN: Rate limit alcanzado para IP 192.168.1.100
   INFO: Load shedding activado (CPU > 70%)
   INFO: Petición rechazada: servidor sobrecargado
   ```

3. **Métricas**:
   ```bash
   curl http://localhost:3000/metrics
   ```
   ```json
   {
     "queue": {
       "size": 50,
       "pending": 200,
       "active": 50
     },
     "server": {
       "cpu": 65,
       "memory": 45,
       "latency_p95": 2500
     }
   }
   ```

---

## Comportamiento del Sistema

### Estratificación de Protección

```
Capa 1: Rate Limiting
→ Bloquea usuarios abusivos (> 100 req/15min)

Capa 2: Request Queue
→ Procesa máximo 50 peticiones simultáneas
→ Resto espera en cola

Capa 3: Load Shedding
→ Si CPU > 70%, rechaza nuevas peticiones
→ Protege el servidor de crashear

Capa 4: Timeout
→ Peticiones en cola > 30s son canceladas
→ Usuario recibe error controlado
```

---

## Conceptos Clave

### 1. Rate Limiting

Limitar peticiones por usuario:
```javascript
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Demasiadas peticiones',
      retryAfter: req.rateLimit.resetTime
    });
  }
});
```

### 2. Bulkhead Pattern

Aislar recursos:
```javascript
const reservasQueue = new PQueue({ concurrency: 50 });
const pagosQueue = new PQueue({ concurrency: 20 });
const notificacionesQueue = new PQueue({ concurrency: 10 });
```

### 3. Load Shedding

Rechazar trabajo cuando sobrecargado:
```javascript
if (sistemaSobrecargado()) {
  res.status(503).send('Service Unavailable');
} else {
  procesarPeticion();
}
```

### 4. Backpressure

Aplicar presión a clientes para que reduzcan carga:
```javascript
res.setHeader('Retry-After', 60);
res.status(503).json({
  error: 'Servidor sobrecargado',
  retryAfter: 60
});
```

---

## Código Clave

### Rate Limiter Completo

```javascript
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');

const limiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:'
  }),
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded: ${req.ip}`);
    res.status(429).json({
      error: 'Demasiadas peticiones',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});
```

### Queue con Timeout

```javascript
const PQueue = require('p-queue');

class RequestQueue {
  constructor(options) {
    this.queue = new PQueue({
      concurrency: options.concurrency || 50,
      timeout: options.timeout || 30000
    });
    
    this.queue.on('active', () => {
      logger.info(`Queue: ${this.queue.size} pending, ${this.queue.pending} active`);
    });
  }
  
  async add(fn) {
    if (this.queue.size > 500) {
      throw new Error('Queue saturada');
    }
    
    return this.queue.add(fn);
  }
}
```

### Load Shedding

```javascript
const os = require('os');

function getSystemLoad() {
  const load = os.loadavg()[0];
  const cpus = os.cpus().length;
  return (load / cpus) * 100;
}

function loadSheddingMiddleware(req, res, next) {
  const load = getSystemLoad();
  
  if (load > 70) {
    logger.warn(`Load shedding: CPU at ${load}%`);
    res.status(503).json({
      error: 'Servidor sobrecargado',
      load: Math.round(load)
    });
  } else {
    next();
  }
}
```

---

## Métricas y Monitoreo

### Indicadores Clave

| Métrica | Normal | Alerta | Crítico |
|---------|--------|--------|---------|
| Peticiones/seg | < 100 | 100-500 | > 500 |
| Cola pendiente | < 50 | 50-200 | > 200 |
| CPU | < 50% | 50-70% | > 70% |
| Latencia p95 | < 2s | 2-5s | > 5s |
| Rate limit hits | < 1% | 1-5% | > 5% |

### Dashboards

1. **Tráfico entrante**: Peticiones por segundo
2. **Estado de la cola**: Tamaño y tiempo de espera
3. **Tasa de rechazo**: % de peticiones rechazadas
4. **CPU y memoria**: Uso de recursos
5. **Latencia**: Distribución de tiempos de respuesta

### Alertas

```yaml
alerts:
  - name: HighTraffic
    condition: requests_per_second > 500
    duration: 1m
    severity: warning
    
  - name: QueueSaturated
    condition: queue_size > 200
    duration: 2m
    severity: critical
    
  - name: HighRateLimitHits
    condition: rate_limit_rejections_percent > 5
    duration: 5m
    severity: warning
```

---

## Configuración Recomendada

```javascript
{
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100,
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  },
  
  queue: {
    concurrency: 50,
    timeout: 30000,
    maxSize: 500
  },
  
  loadShedding: {
    enabled: true,
    cpuThreshold: 70,
    memoryThreshold: 90
  },
  
  circuit

Breaker: {
    errorThresholdPercentage: 50,
    resetTimeout: 15000
  }
}
```

---

## Checklist de Implementación

- [x] Rate limiting configurado
- [x] Cola de peticiones con límite
- [x] Load shedding por CPU
- [x] Timeouts en cola
- [x] Mensajes informativos al usuario
- [x] Headers HTTP apropiados (Retry-After)
- [x] Logging de eventos
- [x] Métricas de cola y tráfico
- [ ] Distributed rate limiting (Redis)
- [ ] Auto-scaling basado en métricas
- [ ] Circuit breakers por endpoint

---

## Conclusión

El **Diluvio de Peticiones** demuestra cómo proteger un sistema ante tráfico masivo.

**Sin protección**:
```
10,000 usuarios → Servidor crashea → 0 ventas
```

**Con rate limiting + queue**:
```
10,000 usuarios → 1,000 exitosos → 9,000 esperan/reintentan
→ Sistema estable
→ Ventas maximizadas sin caer
```

**Patrones aplicados**:
1. Rate Limiting: Limitar peticiones por usuario
2. Request Queue: Procesar de forma controlada
3. Bulkhead: Aislar recursos
4. Load Shedding: Rechazar cuando sobrecargado
5. Backpressure: Informar al cliente cuándo reintentar

**Lección fundamental**:
> Es mejor atender a 1,000 usuarios bien que intentar atender a 10,000 y fallar con todos.

**Resultado**: Sistema que se mantiene estable bajo carga extrema sacrificando disponibilidad total por disponibilidad parcial.
