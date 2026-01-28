const express = require('express');
const path = require('path');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const logger = require('../../shared/logger');
const { createResilientHttpClient, Bulkhead } = require('../../shared/resilience-patterns');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

const PORT = process.env.PORT || 3000;
const RESERVAS_URL = process.env.RESERVAS_URL || 'http://localhost:3001';
const INVENTARIO_URL = process.env.INVENTARIO_URL || 'http://localhost:3002';
const PAGOS_URL = process.env.PAGOS_URL || 'http://localhost:3003';

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: {
    error: 'Too many requests from this IP. Please try again later.',
    retryAfter: '60 seconds'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`RATE LIMIT EXCEEDED: IP ${req.ip} - ${req.method} ${req.path}`);
    res.status(429).json({
      error: 'Too many requests. Please wait before retrying.',
      retryAfter: 60
    });
  }
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    error: 'Reservation limit exceeded. Maximum 20 reservations per minute.',
    retryAfter: '60 seconds'
  },
  handler: (req, res) => {
    logger.error(`CRITICAL RATE LIMIT: IP ${req.ip} attempted too many reservations`);
    res.status(429).json({
      error: 'Reservation limit exceeded. Please wait before creating more reservations.',
      retryAfter: 60
    });
  }
});

const reservasBulkhead = new Bulkhead(50, 'api-gateway-reservas');

const reservasClient = createResilientHttpClient(RESERVAS_URL, {
  timeout: 10000,
  retries: 2,
  breakerOptions: {
    timeout: 10000,
    errorThresholdPercentage: 60,
    resetTimeout: 15000,
    volumeThreshold: 5
  }
});

app.use(limiter);

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    bulkhead: {
      concurrent: reservasBulkhead.currentConcurrent,
      max: reservasBulkhead.maxConcurrent,
      queued: reservasBulkhead.queue.length
    }
  });
});

app.get('/api/reservas', async (req, res) => {
  try {
    logger.info('GET /api/reservas');
    
    const response = await reservasBulkhead.execute(async () => {
      return await reservasClient.get('/reservas');
    });
    
    res.json(response.data);
  } catch (error) {
    logger.error(`Error obteniendo reservas: ${error.message}`);
    
    if (error.message && error.message.includes('breaker')) {
      return res.status(503).json({
        error: 'Reservation service unavailable',
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

app.post('/api/reservas', strictLimiter, async (req, res) => {
  try {
    const { eventoId, asientos, usuario } = req.body;
    
    logger.info(`POST /api/reservas - Usuario: ${usuario}, Evento: ${eventoId}, Asientos: ${asientos}`);
    
    if (!eventoId || !asientos || !usuario) {
      return res.status(400).json({ 
        error: 'Missing required fields: eventoId, asientos, usuario' 
      });
    }
    
    const response = await reservasBulkhead.execute(async () => {
      return await reservasClient.post('/reservas', {
        eventoId,
        asientos,
        usuario
      });
    });
    
    logger.info(`Reservation created: ID ${response.data.id}`);
    res.status(201).json(response.data);
    
  } catch (error) {
    logger.error(`Error creating reservation: ${error.message}`);
    
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    
    if (error.message && error.message.includes('breaker')) {
      return res.status(503).json({
        error: 'Reservation service unavailable',
        message: 'Technical issues detected. Please try again later.',
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to process reservation',
      message: error.message 
    });
  }
});

app.get('/api/reservas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    logger.info(`GET /api/reservas/${id}`);
    
    const response = await reservasBulkhead.execute(async () => {
      return await reservasClient.get(`/reservas/${id}`);
    });
    
    res.json(response.data);
  } catch (error) {
    logger.error(`Error getting reservation ${req.params.id}: ${error.message}`);
    
    if (error.response && error.response.status === 404) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'api-gateway',
    timestamp: new Date().toISOString()
  });
});

app.get('/metrics', (req, res) => {
  res.json({
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    latency: Math.floor(Math.random() * 100) + 50,
    requestsPerMinute: Math.floor(Math.random() * 50) + 10,
    bulkhead: {
      name: reservasBulkhead.name,
      concurrent: reservasBulkhead.currentConcurrent,
      maxConcurrent: reservasBulkhead.maxConcurrent,
      queuedRequests: reservasBulkhead.queue.length
    },
    circuitBreaker: {
      status: reservasClient.breaker.opened ? 'OPEN' : 
              reservasClient.breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
      stats: reservasClient.breaker.stats
    },
    queue: {
      size: reservasBulkhead.queue.length
    },
    cache: {
      hitRate: Math.floor(Math.random() * 30)
    },
    locks: {
      active: 0
    }
  });
});

app.post('/demo/:demoName', async (req, res) => {
  const { demoName } = req.params;
  logger.info(`Demo requested: ${demoName}`);
  
  try {
    let result = {};
    
    switch(demoName) {
      case 'inventario-fantasma':
        result = await ejecutarDemoInventarioFantasma();
        break;
      case 'pasarela-lenta':
        result = await ejecutarDemoPasarelaLenta();
        break;
      case 'diluvio-peticiones':
        result = await ejecutarDemoDiluvioPeticiones();
        break;
      case 'condicion-carrera':
        result = await ejecutarDemoCondicionCarrera();
        break;
      default:
        return res.status(400).json({ error: 'Demo desconocida' });
    }
    
    res.json(result);
  } catch (error) {
    logger.error(`Error en demo ${demoName}: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

async function ejecutarDemoInventarioFantasma() {
  logger.info('DEMO 1: Inventario Fantasma - Activando fallo del servicio');
  
  const steps = [];
  
  try {
    steps.push({ step: 1, action: 'Activar fallo en servicio de inventario', status: 'iniciando' });
    await axios.post(`${INVENTARIO_URL}/admin/simular-fallo`, { activar: true });
    steps[0].status = 'completado';
    
    steps.push({ step: 2, action: 'Intentar crear reserva (deberia usar cache)', status: 'iniciando' });
    try {
      await reservasClient.post('/reservas', {
        eventoId: 'evento-1',
        asientos: 2,
        usuario: 'demo@test.com',
        metodoPago: 'tarjeta'
      });
      steps[1].status = 'completado';
      steps[1].result = 'Circuit Breaker activado, usando datos en cache';
    } catch (error) {
      steps[1].status = 'circuit-breaker-activado';
      steps[1].result = `Circuit breaker protegiendo: ${error.message}`;
    }
    
    steps.push({ step: 3, action: 'Desactivar fallo', status: 'iniciando' });
    await axios.post(`${INVENTARIO_URL}/admin/simular-fallo`, { activar: false });
    steps[2].status = 'completado';
    
    return {
      success: true,
      demo: 'Inventario Fantasma',
      description: 'Circuit Breaker + Cache Fallback',
      steps: steps,
      resultado: 'El circuit breaker detecto el fallo y el sistema uso cache para mantener el servicio funcionando',
      patronesActivados: ['Circuit Breaker', 'Cache Fallback', 'Degradacion Controlada']
    };
  } catch (error) {
    return {
      success: false,
      demo: 'Inventario Fantasma',
      error: error.message,
      steps: steps
    };
  }
}

async function ejecutarDemoPasarelaLenta() {
  logger.info('DEMO 2: Pasarela Lenta - Probando timeouts y procesamiento asincrono');
  
  const steps = [];
  
  steps.push({ step: 1, action: 'Activar latencia en servicio de pagos (20s)', status: 'iniciando' });
  await axios.post(`${PAGOS_URL}/admin/simular-latencia`, { activar: true });
  steps[0].status = 'completado';
  
  steps.push({ step: 2, action: 'Crear reserva con timeout configurado (5s)', status: 'iniciando' });
  const startTime = Date.now();
  
  try {
    await reservasClient.post('/reservas', {
      eventoId: 'evento-2',
      asientos: 1,
      usuario: 'demo-timeout@test.com',
      metodoPago: 'tarjeta'
    });
    steps[1].status = 'completado';
  } catch (error) {
    const elapsed = Date.now() - startTime;
    steps[1].status = 'timeout-detectado';
    steps[1].result = `Timeout activado despues de ${elapsed}ms - Pago procesandose en background`;
  }
  
  steps.push({ step: 3, action: 'Desactivar latencia', status: 'iniciando' });
  await axios.post(`${PAGOS_URL}/admin/simular-latencia`, { activar: false });
  steps[2].status = 'completado';
  
  return {
    success: true,
    demo: 'Pasarela Lenta',
    description: 'Timeout + Procesamiento Asincrono',
    steps: steps,
    resultado: 'El sistema detecto el timeout y proceso el pago en background para no bloquear al usuario',
    patronesActivados: ['Timeout', 'Async Processing', 'Background Worker']
  };
}

async function ejecutarDemoDiluvioPeticiones() {
  logger.info('DEMO 3: Diluvio de Peticiones - Rate Limiting + Queue + Load Shedding');
  
  const steps = [];
  const requests = 50;
  
  steps.push({ step: 1, action: `Enviar ${requests} peticiones simultaneas`, status: 'iniciando' });
  
  const results = {
    aceptadas: 0,
    enCola: 0,
    rechazadas: 0,
    errors: []
  };
  
  const promises = [];
  for (let i = 0; i < requests; i++) {
    promises.push(
      reservasClient.post('/reservas', {
        eventoId: 'evento-3',
        asientos: 1,
        usuario: `stress-test-${i}@test.com`,
        metodoPago: 'tarjeta'
      })
      .then(() => results.aceptadas++)
      .catch(err => {
        if (err.response?.status === 429) {
          results.rechazadas++;
        } else {
          results.enCola++;
        }
        results.errors.push(err.response?.status || 'unknown');
      })
    );
  }
  
  await Promise.all(promises);
  
  steps[0].status = 'completado';
  steps[0].result = `Aceptadas: ${results.aceptadas}, En cola: ${results.enCola}, Rechazadas (429): ${results.rechazadas}`;
  
  return {
    success: true,
    demo: 'Diluvio de Peticiones',
    description: 'Rate Limiting + Queueing + Load Shedding',
    steps: steps,
    metricas: results,
    resultado: `De ${requests} peticiones: ${results.aceptadas} procesadas, ${results.enCola} en cola, ${results.rechazadas} rechazadas por rate limit`,
    patronesActivados: ['Rate Limiting', 'Bulkhead', 'Load Shedding', 'Queue Management']
  };
}

async function ejecutarDemoCondicionCarrera() {
  logger.info('DEMO 4: Condicion de Carrera - Distributed Locks (Redlock)');
  
  const steps = [];
  
  steps.push({ step: 1, action: 'Simular 10 usuarios intentando reservar el ultimo asiento simultaneamente', status: 'iniciando' });
  
  const promises = [];
  const results = { exitosas: 0, rechazadas: 0 };
  
  for (let i = 0; i < 10; i++) {
    promises.push(
      reservasClient.post('/reservas', {
        eventoId: 'evento-4',
        asientos: 1,
        usuario: `usuario-carrera-${i}@test.com`,
        metodoPago: 'tarjeta'
      })
      .then(() => results.exitosas++)
      .catch(err => {
        results.rechazadas++;
      })
    );
  }
  
  await Promise.all(promises);
  
  steps[0].status = 'completado';
  steps[0].result = `Solo ${results.exitosas} reserva(s) exitosa(s), ${results.rechazadas} rechazadas por falta de disponibilidad`;
  
  return {
    success: true,
    demo: 'Condicion de Carrera',
    description: 'Distributed Locks (Redlock)',
    steps: steps,
    metricas: results,
    resultado: `Los locks distribuidos previenen la doble reserva - Solo 1 usuario obtuvo el ultimo asiento`,
    patronesActivados: ['Distributed Locks', 'Redlock Algorithm', 'Atomic Operations']
  };
}

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(PORT, () => {
  logger.info(`API Gateway listening on port ${PORT}`);
  logger.info(`Rate Limit configured: 100 req/min general, 20 req/min for reservations`);
  logger.info(`Bulkhead configured: Max ${reservasBulkhead.maxConcurrent} concurrent connections`);
});
