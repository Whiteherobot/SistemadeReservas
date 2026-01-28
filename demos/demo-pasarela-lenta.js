const axios = require('axios');

const API_GATEWAY = 'http://localhost:3000';
const PAGOS_SERVICE = 'http://localhost:3003';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function crearReserva(eventoId, usuario, asientos = 1) {
  const inicio = Date.now();
  
  try {
    console.log(`\nInitiating reservation for ${usuario}...`);
    
    const response = await axios.post(`${API_GATEWAY}/api/reservas`, {
      eventoId,
      asientos,
      usuario,
      metodoPago: 'tarjeta'
    }, {
      timeout: 35000
    });
    
    const duracion = ((Date.now() - inicio) / 1000).toFixed(2);
    console.log(`Successful reservation in ${duracion}s - ID: ${response.data.reserva.id}`);
    
    return { success: true, duracion, data: response.data };
    
  } catch (error) {
    const duracion = ((Date.now() - inicio) / 1000).toFixed(2);
    
    if (error.code === 'ECONNABORTED') {
      console.log(`TIMEOUT after ${duracion}s`);
    } else if (error.response) {
      console.log(`Error ${error.response.status} in ${duracion}s: ${error.response.data.error}`);
    } else {
      console.log(`Error in ${duracion}s: ${error.message}`);
    }
    
    return { success: false, duracion, error: error.message };
  }
}

async function demo() {
  console.log('\n' + '='.repeat(80));
  console.log('DEMO FAILURE #2: SLOW GATEWAY');
  console.log('='.repeat(80) + '\n');

  try {
    console.log('STEP 1: Reservation with normal payment gateway\n');
    
    await crearReserva('evento-1', 'usuario-normal@example.com', 2);
    
    await sleep(2000);

    console.log('\nSTEP 2: Enabling EXTREME LATENCY in payment service\n');
    
    await axios.post(`${PAGOS_SERVICE}/admin/simular-latencia`, {
      activar: true,
      latenciaMs: 20000
    });
    
    console.log('Payment service configured with 20 second latency');
    
    await sleep(2000);

    console.log('\nSTEP 3: Creating CONCURRENT reservations with slow gateway\n');
    console.log('Bulkhead will limit concurrency to protect resources');
    console.log('Each payment will take ~20 seconds...\n');
    
    const promesas = [];
    
    for (let i = 1; i <= 3; i++) {
      promesas.push(crearReserva('evento-2', `usuario-concurrente-${i}@example.com`, 1));
      await sleep(500);
    }
    
    console.log('\nWaiting for all concurrent reservations to complete...');
    console.log('   (This will take ~20-25 seconds due to simulated latency)\n');
    
    const resultados = await Promise.all(promesas);
    
    console.log('\nCONCURRENT RESERVATION RESULTS:');
    resultados.forEach((resultado, index) => {
      console.log(`   Reservation ${index + 1}: ${resultado.success ? 'Successful' : 'Failed'} - ${resultado.duracion}s`);
    });

    const exitosas = resultados.filter(r => r.success).length;
    const fallidas = resultados.filter(r => !r.success).length;
    
    console.log(`\n   Total: ${exitosas} successful, ${fallidas} failed`);

    console.log('\nSTEP 4: Checking system metrics\n');
    
    const health = await axios.get(`${API_GATEWAY}/health`);
    console.log('Bulkhead Status:');
    console.log(`   Current concurrency: ${health.data.bulkhead.concurrent}/${health.data.bulkhead.max}`);
    console.log(`   Queued: ${health.data.bulkhead.queued}`);

    console.log('\nSTEP 5: Attempting to SATURATE Bulkhead\n');
    console.log('Creating 15 simultaneous reservations to saturate bulkhead (limit: 10)...\n');
    
    const promesasSaturacion = [];
    for (let i = 1; i <= 15; i++) {
      promesasSaturacion.push(
        crearReserva('evento-3', `usuario-saturacion-${i}@example.com`, 1)
          .then(resultado => ({ usuario: i, ...resultado }))
      );
    }
    
    console.log('Executing 15 reservations in parallel...');
    console.log('   Watch how Bulkhead queues excess requests\n');
    
    const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), 30000));
    const race = await Promise.race([
      Promise.all(promesasSaturacion),
      timeout
    ]);
    
    if (race === 'timeout') {
      console.log('\nDemo timeout - some reservations still in progress');
      console.log('   (In production would continue processing in background)');
    } else {
      const exitosasSat = race.filter(r => r.success).length;
      console.log(`\n${exitosasSat}/15 reservations completed successfully`);
    }

    console.log('\nSTEP 6: Restoring payment service to normal speed\n');
    
    await axios.post(`${PAGOS_SERVICE}/admin/simular-latencia`, {
      activar: false
    });
    
    console.log('Payment service restored to normal speed');
    
    await sleep(1000);

    console.log('\nSTEP 7: Verifying normal operation after restoration\n');
    
    await crearReserva('evento-1', 'usuario-final@example.com', 1);

    console.log('\n' + '='.repeat(80));
    console.log('CONCLUSIONS:');
    console.log('='.repeat(80));
    console.log('\n1. System handles extreme latency without collapsing');
    console.log('2. Timeout protects against indefinite blocking');
    console.log('3. Bulkhead prevents resource saturation (max 10 concurrent connections)');
    console.log('4. Excess requests are queued instead of being rejected');
    console.log('5. Retry with backoff allows recovery from transient failures');
    console.log('6. Circuit Breaker would protect system if failures persist');
    console.log('\nPatterns implemented: Timeout + Retry + Bulkhead + Circuit Breaker');
    console.log('');

  } catch (error) {
    console.error('\nError executing demo:', error.message);
  }
}

console.log('\nPREREQUISITES:');
console.log('   1. All services must be running (docker-compose up)');
console.log('   2. System must be in initial state');
console.log('   3. This demo will take approximately 2-3 minutes\n');
console.log('Starting demo in 3 seconds...\n');

setTimeout(demo, 3000);
