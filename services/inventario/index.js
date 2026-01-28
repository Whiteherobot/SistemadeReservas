const express = require('express');
const cors = require('cors');
const Redis = require('ioredis');
const logger = require('../../shared/logger');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'inventario',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3002;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const SIMULAR_FALLO = process.env.SIMULAR_FALLO === 'true';

const redis = new Redis(REDIS_URL, {
  retryStrategy: () => null,
  enableOfflineQueue: false,
  lazyConnect: true
});

let redisConnected = false;

redis.on('error', (error) => {
  if (redisConnected) {
    logger.warn(`Redis connection lost: ${error.message}. Switching to in-memory storage.`);
  }
  redisConnected = false;
});

redis.connect().then(() => {
  logger.info('Redis connected successfully');
  redisConnected = true;
  inicializarInventario();
}).catch((error) => {
  logger.warn(`Redis not available: ${error.message}. Using in-memory storage.`);
});

app.use((req, res, next) => {
  if (SIMULAR_FALLO) {
    logger.error(`SERVICE DOWN - Simulating inventory service failure`);
    return;
  }
  next();
});

const inventarioMemoria = new Map();

async function inicializarInventario() {
  const eventos = [
    { id: 'evento-1', nombre: 'Rock Concert', asientosDisponibles: 100, precio: 50 },
    { id: 'evento-2', nombre: 'Classical Theater', asientosDisponibles: 50, precio: 30 },
    { id: 'evento-3', nombre: 'Music Festival', asientosDisponibles: 500, precio: 80 },
    { id: 'evento-4', nombre: 'Stand-up Comedy', asientosDisponibles: 1, precio: 25 }
  ];

  for (const evento of eventos) {
    inventarioMemoria.set(evento.id, evento);
    if (redisConnected) {
      await redis.set(`inventario:${evento.id}`, JSON.stringify(evento));
    }
  }

  logger.info('Inventory initialized');
}

inicializarInventario();

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'inventario',
    timestamp: new Date().toISOString(),
    simulandoFallo: SIMULAR_FALLO
  });
});

app.get('/inventario/:eventoId', async (req, res) => {
  try {
    const { eventoId } = req.params;
    logger.info(`GET /inventario/${eventoId}`);

    let evento = null;
    
    if (redisConnected) {
      try {
        const eventoData = await redis.get(`inventario:${eventoId}`);
        if (eventoData) {
          evento = JSON.parse(eventoData);
        }
      } catch (error) {
        logger.warn(`Redis error reading evento ${eventoId}: ${error.message}. Falling back to memory.`);
        redisConnected = false;
      }
    }
    
    if (!evento) {
      evento = inventarioMemoria.get(eventoId);
    }
    
    if (!evento) {
      logger.warn(`Event not found: ${eventoId}`);
      return res.status(404).json({ 
        error: 'Event not found',
        eventoId 
      });
    }

    logger.info(`Available: ${evento.asientosDisponibles} seats for ${evento.nombre}`);
    
    res.json({
      eventoId: evento.id,
      nombre: evento.nombre,
      asientosDisponibles: evento.asientosDisponibles,
      precio: evento.precio,
      disponible: evento.asientosDisponibles > 0
    });

  } catch (error) {
    logger.error(`Error consulting inventory: ${error.message}`);
    res.status(503).json({ 
      error: 'Inventory service unavailable',
      message: 'Please try again in a few seconds'
    });
  }
});

app.get('/inventario', async (req, res) => {
  try {
    logger.info('GET /inventario');

    let eventos = [];
    
    if (redisConnected) {
      try {
        const keys = await redis.keys('inventario:*');
        for (const key of keys) {
          const eventoData = await redis.get(key);
          if (eventoData) {
            eventos.push(JSON.parse(eventoData));
          }
        }
      } catch (error) {
        logger.warn(`Redis error listing inventory: ${error.message}. Falling back to memory.`);
        redisConnected = false;
      }
    }
    
    if (!redisConnected) {
      eventos = Array.from(inventarioMemoria.values());
    }

    logger.info(`Returning ${eventos.length} events`);
    res.json(eventos);

  } catch (error) {
    logger.error(`Error getting inventory: ${error.message}`);
    res.status(503).json({ 
      error: 'Inventory service unavailable',
      message: 'Please try again in a few seconds'
    });
  }
});

app.post('/inventario/:eventoId/reservar', async (req, res) => {
  try {
    const { eventoId } = req.params;
    const { cantidad } = req.body;

    logger.info(`POST /inventario/${eventoId}/reservar - Quantity: ${cantidad}`);

    if (!cantidad || cantidad <= 0) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }

    if (!redisConnected) {
      const evento = inventarioMemoria.get(eventoId);
      
      if (!evento) {
        return res.status(404).json({ error: 'Event not found' });
      }
      
      if (evento.asientosDisponibles < cantidad) {
        return res.status(409).json({ 
          error: 'Insufficient seats',
          disponibles: evento.asientosDisponibles,
          solicitados: cantidad
        });
      }
      
      evento.asientosDisponibles -= cantidad;
      inventarioMemoria.set(eventoId, evento);
      
      logger.info(`Reservation completed - Remaining seats: ${evento.asientosDisponibles}`);
      
      return res.json({
        success: true,
        eventoId,
        nombre: evento.nombre,
        asientosReservados: cantidad,
        asientosDisponibles: evento.asientosDisponibles
      });
    }

    try {
      const script = `
      local key = KEYS[1]
      local cantidad = tonumber(ARGV[1])
      
      local evento = redis.call('GET', key)
      if not evento then
        return {err = 'Event not found'}
      end
      
      local eventoData = cjson.decode(evento)
      
      if eventoData.asientosDisponibles < cantidad then
        return {err = 'Insufficient seats'}
      end
      
      eventoData.asientosDisponibles = eventoData.asientosDisponibles - cantidad
      redis.call('SET', key, cjson.encode(eventoData))
      
      return eventoData.asientosDisponibles
    `;

      const result = await redis.eval(
        script,
        1,
        `inventario:${eventoId}`,
        cantidad
      );

      logger.info(`Reservation successful. Remaining seats: ${result}`);
      
      return res.json({
        success: true,
        eventoId,
        cantidadReservada: cantidad,
        asientosRestantes: result
      });
    } catch (error) {
      logger.warn(`Redis error reserving seats: ${error.message}. Falling back to memory.`);
      redisConnected = false;
    }
    
    const evento = inventarioMemoria.get(eventoId);
    
    if (!evento) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    if (evento.asientosDisponibles < cantidad) {
      return res.status(409).json({ 
        error: 'Insufficient seats',
        disponibles: evento.asientosDisponibles,
        solicitados: cantidad
      });
    }
    
    evento.asientosDisponibles -= cantidad;
    inventarioMemoria.set(eventoId, evento);
    
    logger.info(`Reservation completed (fallback) - Remaining seats: ${evento.asientosDisponibles}`);
    
    return res.json({
      success: true,
      eventoId,
      nombre: evento.nombre,
      asientosReservados: cantidad,
      asientosDisponibles: evento.asientosDisponibles
    });

  } catch (error) {
    logger.error(`Error reserving seats: ${error.message}`);
    
    if (error.message.includes('Insufficient seats')) {
      return res.status(409).json({ 
        error: 'Insufficient seats available' 
      });
    }
    
    if (error.message.includes('Event not found')) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    res.status(503).json({ 
      error: 'Inventory service unavailable',
      message: 'Please try again in a few seconds'
    });
  }
});

app.post('/inventario/:eventoId/liberar', async (req, res) => {
  try {
    const { eventoId } = req.params;
    const { cantidad } = req.body;

    logger.info(`POST /inventario/${eventoId}/liberar - Quantity: ${cantidad}`);

    if (!cantidad || cantidad <= 0) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }

    let evento = null;
    
    if (redisConnected) {
      try {
        const eventoData = await redis.get(`inventario:${eventoId}`);
        
        if (!eventoData) {
          return res.status(404).json({ error: 'Event not found' });
        }

        evento = JSON.parse(eventoData);
        evento.asientosDisponibles += cantidad;
        
        await redis.set(`inventario:${eventoId}`, JSON.stringify(evento));
      } catch (error) {
        logger.warn(`Redis error releasing seats: ${error.message}. Falling back to memory.`);
        redisConnected = false;
      }
    }
    
    if (!redisConnected) {
      evento = inventarioMemoria.get(eventoId);
      
      if (!evento) {
        return res.status(404).json({ error: 'Event not found' });
      }
      
      evento.asientosDisponibles += cantidad;
      inventarioMemoria.set(eventoId, evento);
    }

    logger.info(`Seats released. Total available: ${evento.asientosDisponibles}`);
    
    res.json({
      success: true,
      eventoId,
      cantidadLiberada: cantidad,
      asientosDisponibles: evento.asientosDisponibles
    });

  } catch (error) {
    logger.error(`Error releasing seats: ${error.message}`);
    res.status(503).json({ 
      error: 'Inventory service unavailable',
      message: 'Please try again in a few seconds'
    });
  }
});

app.post('/admin/simular-fallo', (req, res) => {
  const { activar } = req.body;
  process.env.SIMULAR_FALLO = activar ? 'true' : 'false';
  
  logger.warn(`Failure simulation ${activar ? 'ACTIVATED' : 'DEACTIVATED'}`);
  
  res.json({
    message: `Failure simulation ${activar ? 'activated' : 'deactivated'}`,
    simulandoFallo: activar
  });
});

app.post('/admin/configurar-evento', async (req, res) => {
  const { eventoId, asientos } = req.body;
  
  try {
    logger.info(`Configuring ${eventoId} with ${asientos} seats`);
    
    const eventoBase = {
      'evento-1': { nombre: 'Rock Concert', precio: 50 },
      'evento-2': { nombre: 'Classical Theater', precio: 80 },
      'evento-3': { nombre: 'Music Festival', precio: 120 },
      'evento-4': { nombre: 'Stand-up Comedy', precio: 30 }
    };
    
    const evento = {
      id: eventoId,
      nombre: eventoBase[eventoId]?.nombre || 'Custom Event',
      asientosDisponibles: asientos,
      precio: eventoBase[eventoId]?.precio || 50
    };
    
    if (redisConnected) {
      await redis.set(`inventario:${eventoId}`, JSON.stringify(evento));
    } else {
      inventarioMemoria.set(eventoId, evento);
    }
    
    logger.info(`${eventoId} configured successfully with ${asientos} seats`);
    res.json({ success: true, evento });
  } catch (error) {
    logger.error(`Error configuring event: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  logger.info(`Inventory service listening on port ${PORT}`);
  logger.info(`Failure simulation: ${SIMULAR_FALLO ? 'ACTIVATED' : 'DEACTIVATED'}`);
});

