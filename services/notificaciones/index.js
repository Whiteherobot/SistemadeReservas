const express = require('express');
const cors = require('cors');
const logger = require('../../shared/logger');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'notificaciones',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3004;

const notificaciones = [];

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'notificaciones',
    timestamp: new Date().toISOString()
  });
});

app.post('/notificaciones/enviar', async (req, res) => {
  try {
    const { tipo, destinatario, asunto, mensaje, reservaId } = req.body;
    
    logger.info(`Sending notification - Type: ${tipo}, Recipient: ${destinatario}`);

    await new Promise(resolve => setTimeout(resolve, 200));

    const notificacion = {
      id: notificaciones.length + 1,
      tipo,
      destinatario,
      asunto,
      mensaje,
      reservaId,
      estado: 'enviado',
      timestamp: new Date().toISOString()
    };

    notificaciones.push(notificacion);

    logger.info(`Notification sent successfully: ${notificacion.id}`);

    res.status(200).json(notificacion);
  } catch (error) {
    logger.error(`Error sending notification: ${error.message}`);
    res.status(500).json({ error: 'Error sending notification' });
  }
});

app.get('/notificaciones', (req, res) => {
  res.json(notificaciones);
});

app.listen(PORT, () => {
  logger.info(`Notifications service listening on port ${PORT}`);
});
