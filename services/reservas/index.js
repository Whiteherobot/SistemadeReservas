const express = require('express');
const cors = require('cors');
const Redis = require('ioredis');
const Redlock = require('redlock').default;
const { v4: uuidv4 } = require('uuid');
const logger = require('../../shared/logger');
const { createResilientHttpClient, Bulkhead } = require('../../shared/resilience-patterns');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const INVENTARIO_URL = process.env.INVENTARIO_URL || 'http://localhost:3002';
const PAGOS_URL = process.env.PAGOS_URL || 'http://localhost:3003';
const NOTIFICACIONES_URL = process.env.NOTIFICACIONES_URL || 'http://localhost:3004';

const redis = new Redis(REDIS_URL, {
  retryStrategy: () => null,
  enableOfflineQueue: false,
  lazyConnect: true
});

let redlock = null;

redis.connect().then(() => {
  logger.info('Redis connected successfully');
  redlock = new Redlock([redis], {
    driftFactor: 0.01,
    retryCount: 10,
    retryDelay: 200,
    retryJitter: 200,
    automaticExtensionThreshold: 500
  });

  redlock.on('error', (error) => {
    logger.error(`Redlock error: ${error.message}`);
  });
}).catch((error) => {
  logger.warn(`Redis not available: ${error.message}. Running without distributed locks.`);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'reservas',
    timestamp: new Date().toISOString()
  });
});

const inventarioCache = new Map();

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

const INVENTARIO_CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache TTL for easier manual testing

async function consultarInventario(eventoId) {
  try {
    // Attempt to get fresh data
    const response = await inventarioClient.get(`/inventario/${eventoId}`);

    // On success, update the local cache
    inventarioCache.set(eventoId, {
      data: response.data,
      timestamp: Date.now()
    });

    return response.data;
  } catch (error) {
    // If we reach here, the service is down/slow and the breaker didn't return a fallback
    // (or the breaker is OPEN)
    logger.warn(`Inventory service unavailable for ${eventoId}: ${error.message}`);

    const cached = inventarioCache.get(eventoId);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < INVENTARIO_CACHE_TTL) {
        logger.info(`RESILIENCE: Using cached data for ${eventoId} (${Math.floor(age / 1000)}s old)`);
        return { ...cached.data, fromCache: true };
      } else {
        logger.error(`Cache expired for ${eventoId} (${Math.floor(age / 1000)}s old)`);
      }
    } else {
      logger.warn(`No cached data available for ${eventoId}`);
    }

    throw new Error(`Inventory service unavailable and no valid cache for ${eventoId}`);
  }
}

const pagosBulkhead = new Bulkhead(10, 'pagos-bulkhead');

const pagosClient = createResilientHttpClient(PAGOS_URL, {
  timeout: 25000,
  retries: 1,
  breakerOptions: {
    timeout: 25000,
    errorThresholdPercentage: 70,
    resetTimeout: 30000,
    volumeThreshold: 3
  }
});

async function procesarPago(reservaId, monto, metodoPago, usuario) {
  return pagosBulkhead.execute(async () => {
    logger.info(`Processing payment: Reservation ${reservaId}, Amount $${monto}`);

    try {
      const response = await pagosClient.post('/pagos/procesar', {
        reservaId,
        monto,
        metodoPago,
        usuario
      });

      return response.data;
    } catch (error) {
      logger.error(`Error processing payment: ${error.message}`);

      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        throw new Error('TIMEOUT_PAGO: Payment taking longer than expected. Please verify status later.');
      }

      throw error;
    }
  });
}

const notificacionesClient = createResilientHttpClient(NOTIFICACIONES_URL, {
  timeout: 3000,
  retries: 1,
  breakerOptions: {
    timeout: 3000,
    errorThresholdPercentage: 80,
    resetTimeout: 10000
  }
});

notificacionesClient.breaker.fallback(() => {
  logger.warn('Notifications fallback: Notification skipped');
  return { data: { fallback: true, message: 'Notification skipped' } };
});

const reservas = new Map();

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'reservas',
    timestamp: new Date().toISOString(),
    stats: {
      totalReservas: reservas.size,
      pagosBulkhead: {
        concurrent: pagosBulkhead.currentConcurrent,
        max: pagosBulkhead.maxConcurrent,
        queued: pagosBulkhead.queue.length
      }
    }
  });
});

app.get('/reservas', (req, res) => {
  const todas = Array.from(reservas.values());
  logger.info(`GET /reservas - Total: ${todas.length}`);
  res.json(todas);
});

app.get('/reservas/:id', (req, res) => {
  const { id } = req.params;
  const reserva = reservas.get(id);

  if (!reserva) {
    return res.status(404).json({ error: 'Reservation not found' });
  }

  res.json(reserva);
});

app.post('/reservas', async (req, res) => {
  const { eventoId, asientos, usuario, metodoPago = 'tarjeta' } = req.body;
  const reservaId = uuidv4();

  logger.info(`New reservation started: ID ${reservaId}, User ${usuario}, Event ${eventoId}, Seats ${asientos}`);

  const lockKey = `lock:evento:${eventoId}`;
  let lock = null;

  try {
    if (redlock) {
      logger.info(`Acquiring distributed lock for event ${eventoId}`);
      lock = await redlock.acquire([lockKey], 10000);
      logger.info(`Lock acquired successfully`);
    } else {
      logger.warn(`Redlock not available, proceeding without distributed lock`);
    }

    logger.info(`Checking inventory availability`);
    let inventario;

    try {
      inventario = await consultarInventario(eventoId);

      if (inventario.fromCache) {
        logger.warn(`Using cached inventory data`);
      }

      if (!inventario.disponible || inventario.asientosDisponibles < asientos) {
        logger.warn(`Insufficient seats: Requested ${asientos}, Available ${inventario.asientosDisponibles}`);

        if (lock) await lock.release();

        return res.status(409).json({
          error: 'Seats not available',
          solicitados: asientos,
          disponibles: inventario.asientosDisponibles,
          fromCache: inventario.fromCache || false
        });
      }

      logger.info(`Availability confirmed: ${inventario.asientosDisponibles} seats`);

    } catch (error) {
      logger.error(`Error checking inventory: ${error.message}`);
      if (lock) await lock.release();

      return res.status(503).json({
        error: 'Inventory service unavailable',
        message: 'Cannot verify availability at this time. Please try later.'
      });
    }

    logger.info(`Reserving ${asientos} seats in inventory`);

    try {
      const reservaResponse = await inventarioClient.post(`/inventario/${eventoId}/reservar`, {
        cantidad: asientos
      });

      logger.info(`Seats reserved. Remaining: ${reservaResponse.data.asientosRestantes}`);
    } catch (error) {
      logger.error(`Error reserving seats: ${error.message}`);
      await lock.release();

      if (error.response && error.response.status === 409) {
        return res.status(409).json({
          error: 'Seats no longer available',
          message: 'Another user reserved these seats while processing your request'
        });
      }

      return res.status(500).json({
        error: 'Error reserving seats',
        message: error.message
      });
    }

    const monto = inventario.precio * asientos;
    logger.info(`Processing payment of $${monto}`);

    let pagoData;
    try {
      pagoData = await procesarPago(reservaId, monto, metodoPago, usuario);
      logger.info(`Payment processed successfully. Transaction: ${pagoData.transaccionId}`);

    } catch (error) {
      logger.error(`Error processing payment: ${error.message}`);

      logger.warn(`Executing compensation: Releasing reserved seats`);

      try {
        await inventarioClient.post(`/inventario/${eventoId}/liberar`, {
          cantidad: asientos
        });
        logger.info(`Seats released successfully`);
      } catch (liberarError) {
        logger.error(`CRITICAL: Could not release seats: ${liberarError.message}`);
      }

      if (lock) await lock.release();

      if (error.message.includes('TIMEOUT_PAGO')) {
        return res.status(408).json({
          error: 'Payment processing timeout',
          message: 'Payment taking longer than expected. Your reservation has been cancelled. Please try again.',
          reservaId
        });
      }

      return res.status(402).json({
        error: 'Payment rejected',
        message: error.message,
        reservaId
      });
    }

    logger.info(`Creating reservation record`);

    const reserva = {
      id: reservaId,
      eventoId,
      eventoNombre: inventario.nombre,
      asientos,
      usuario,
      monto,
      metodoPago,
      transaccionId: pagoData.transaccionId,
      estado: 'confirmada',
      timestamp: new Date().toISOString()
    };

    reservas.set(reservaId, reserva);
    logger.info(`Reservation created successfully`);

    logger.info(`Sending notification to user`);

    try {
      await notificacionesClient.post('/notificaciones/enviar', {
        tipo: 'email',
        destinatario: usuario,
        asunto: 'Reservation confirmed',
        mensaje: `Your reservation ${reservaId} for ${inventario.nombre} has been confirmed. Total: $${monto}`,
        reservaId
      });
      logger.info(`Notification sent`);
    } catch (error) {
      logger.warn(`Could not send notification (non-critical): ${error.message}`);
    }

    if (lock) await lock.release();
    if (lock) logger.info(`Lock released`);

    logger.info(`Reservation completed successfully - ID: ${reservaId}`);

    res.status(201).json({
      success: true,
      reserva,
      message: 'Reservation created successfully'
    });

  } catch (error) {
    if (lock) {
      try {
        await lock.release();
      } catch (releaseError) {
        logger.error(`Error releasing lock: ${releaseError.message}`);
      }
    }

    logger.error(`Reservation failed - ID: ${reservaId}, Error: ${error.message}`);

    if (error.message.includes('lock')) {
      return res.status(409).json({
        error: 'Reservation in progress',
        message: 'Another reservation in progress for this event. Please try again in a moment.'
      });
    }

    res.status(500).json({
      error: 'Error processing reservation',
      message: error.message,
      reservaId
    });
  }
});

app.delete('/reservas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    logger.info(`DELETE /reservas/${id} - Cancelling reservation`);

    const reserva = reservas.get(id);

    if (!reserva) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    if (reserva.estado === 'cancelada') {
      return res.status(409).json({ error: 'Reservation already cancelled' });
    }

    await pagosClient.post('/pagos/reembolsar', {
      transaccionId: reserva.transaccionId,
      motivo: 'Reservation cancellation'
    });

    await inventarioClient.post(`/inventario/${reserva.eventoId}/liberar`, {
      cantidad: reserva.asientos
    });

    reserva.estado = 'cancelada';
    reserva.fechaCancelacion = new Date().toISOString();

    logger.info(`Reservation cancelled successfully: ${id}`);

    res.json({
      success: true,
      message: 'Reservation cancelled and refund processed',
      reserva
    });

  } catch (error) {
    logger.error(`Error cancelling reservation: ${error.message}`);
    res.status(500).json({ error: 'Error cancelling reservation' });
  }
});

app.listen(PORT, () => {
  logger.info(`Reservations service listening on port ${PORT}`);
  logger.info(`Redlock configured for distributed locks (requires Redis)`);
});
