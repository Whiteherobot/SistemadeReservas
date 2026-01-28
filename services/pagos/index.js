const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../shared/logger');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'pagos',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3003;
const SIMULAR_LATENCIA = process.env.SIMULAR_LATENCIA === 'true';
const LATENCIA_MS = parseInt(process.env.LATENCIA_MS || '20000', 10);

const transacciones = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.use(async (req, res, next) => {
  if (SIMULAR_LATENCIA && req.path !== '/health' && req.path !== '/admin/simular-latencia') {
    const latencia = LATENCIA_MS;
    logger.warn(`Simulating latency of ${latencia}ms on ${req.method} ${req.path}`);
    await sleep(latencia);
  }
  next();
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'pagos',
    timestamp: new Date().toISOString(),
    simulandoLatencia: SIMULAR_LATENCIA,
    latenciaMs: LATENCIA_MS
  });
});

app.post('/pagos/procesar', async (req, res) => {
  try {
    const { reservaId, monto, metodoPago, usuario } = req.body;
    
    logger.info(`POST /pagos/procesar - Reservation: ${reservaId}, Amount: $${monto}, User: ${usuario}`);

    if (!reservaId || !monto || !metodoPago || !usuario) {
      return res.status(400).json({ 
        error: 'Missing required fields: reservaId, monto, metodoPago, usuario' 
      });
    }

    if (monto <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    logger.info(`Processing payment of $${monto} for reservation ${reservaId}`);
    
    await sleep(Math.random() * 1000 + 500);

    const exito = Math.random() > 0.05;

    if (!exito) {
      logger.error(`Payment DECLINED for reservation ${reservaId}`);
      return res.status(402).json({
        error: 'Payment rejected',
        codigo: 'PAYMENT_DECLINED',
        mensaje: 'Card was declined. Please try another payment method.'
      });
    }

    const transaccionId = uuidv4();
    const transaccion = {
      id: transaccionId,
      reservaId,
      monto,
      metodoPago,
      usuario,
      estado: 'completado',
      timestamp: new Date().toISOString()
    };

    transacciones.set(transaccionId, transaccion);

    logger.info(`Payment APPROVED - Transaction: ${transaccionId}, Amount: $${monto}`);

    res.status(200).json({
      success: true,
      transaccionId,
      reservaId,
      monto,
      estado: 'completado',
      mensaje: 'Payment processed successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error(`Error processing payment: ${error.message}`);
    res.status(500).json({ 
      error: 'Error processing payment',
      message: error.message 
    });
  }
});

app.get('/pagos/transaccion/:transaccionId', (req, res) => {
  try {
    const { transaccionId } = req.params;
    logger.info(`GET /pagos/transaccion/${transaccionId}`);

    const transaccion = transacciones.get(transaccionId);

    if (!transaccion) {
      logger.warn(`Transaction not found: ${transaccionId}`);
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(transaccion);
  } catch (error) {
    logger.error(`Error querying transaction: ${error.message}`);
    res.status(500).json({ error: 'Error querying transaction' });
  }
});

app.post('/pagos/reembolsar', async (req, res) => {
  try {
    const { transaccionId, motivo } = req.body;
    
    logger.info(`POST /pagos/reembolsar - Transaction: ${transaccionId}, Reason: ${motivo}`);

    const transaccion = transacciones.get(transaccionId);

    if (!transaccion) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (transaccion.estado === 'reembolsado') {
      return res.status(409).json({ error: 'This transaction already has a refund' });
    }

    await sleep(500);

    transaccion.estado = 'reembolsado';
    transaccion.motivoReembolso = motivo;
    transaccion.fechaReembolso = new Date().toISOString();

    logger.info(`Refund processed for transaction ${transaccionId}`);

    res.json({
      success: true,
      transaccionId,
      monto: transaccion.monto,
      estado: 'reembolsado',
      mensaje: 'Refund processed successfully'
    });

  } catch (error) {
    logger.error(`Error processing refund: ${error.message}`);
    res.status(500).json({ error: 'Error processing refund' });
  }
});

app.get('/pagos/transacciones', (req, res) => {
  const todas = Array.from(transacciones.values());
  logger.info(`GET /pagos/transacciones - Total: ${todas.length}`);
  res.json(todas);
});

app.post('/admin/simular-latencia', (req, res) => {
  const { activar, latenciaMs } = req.body;
  
  process.env.SIMULAR_LATENCIA = activar ? 'true' : 'false';
  
  if (latenciaMs !== undefined) {
    process.env.LATENCIA_MS = latenciaMs.toString();
  }
  
  logger.warn(`Latency simulation ${activar ? 'ACTIVATED' : 'DEACTIVATED'} - Latency: ${process.env.LATENCIA_MS}ms`);
  
  res.json({
    message: `Latency simulation ${activar ? 'activated' : 'deactivated'}`,
    simulandoLatencia: activar,
    latenciaMs: parseInt(process.env.LATENCIA_MS, 10)
  });
});

app.listen(PORT, () => {
  logger.info(`Payment service listening on port ${PORT}`);
  logger.info(`Latency simulation: ${SIMULAR_LATENCIA ? 'ACTIVATED' : 'DEACTIVATED'} (${LATENCIA_MS}ms)`);
});
