const axios = require('axios');

const API_GATEWAY = 'http://localhost:3000';
const INVENTARIO_SERVICE = 'http://localhost:3002';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function demo() {
  console.log('\n' + '='.repeat(80));
  console.log('DEMO FAILURE #1: PHANTOM INVENTORY');
  console.log('='.repeat(80) + '\n');

  try {
    console.log('STEP 1: Successful reservation with inventory working\n');

    const reservaExitosa = await axios.post(`${API_GATEWAY}/api/reservas`, {
      eventoId: 'evento-1',
      asientos: 2,
      usuario: 'usuario-demo@example.com',
      metodoPago: 'tarjeta'
    });

    console.log('Successful reservation:', reservaExitosa.data.reserva.id);
    console.log('   Seats reserved: 2');
    console.log('   Status: ', reservaExitosa.data.reserva.estado);

    await sleep(2000);

    console.log('\nSTEP 2: Simulating inventory service OUTAGE\n');

    try {
      await axios.post(`${INVENTARIO_SERVICE}/admin/simular-fallo`, {
        activar: true
      });
      console.log('Inventory service DOWN (not responding to requests)');
    } catch (error) {
      console.log('Could not contact inventory service');
    }

    await sleep(2000);

    console.log('\nSTEP 3: Attempting reservation with inventory DOWN\n');

    for (let i = 1; i <= 5; i++) {
      console.log(`\nAttempt ${i}/5:`);

      try {
        const response = await axios.post(`${API_GATEWAY}/api/reservas`, {
          eventoId: 'evento-1',
          asientos: 1,
          usuario: `usuario${i}@example.com`,
          metodoPago: 'tarjeta'
        }, {
          timeout: 8000
        });

        console.log('   Reservation processed (using cache):', response.data);

      } catch (error) {
        if (error.response) {
          console.log(`   Error ${error.response.status}: ${error.response.data.error}`);
          if (error.response.data.fallback) {
            console.log('   FALLBACK activated:', error.response.data.fallback);
          }
        } else if (error.code === 'ECONNABORTED') {
          console.log('   Timeout - Circuit Breaker should activate soon');
        } else {
          console.log('   Error:', error.message);
        }
      }

      await sleep(1500);
    }

    console.log('\nSTEP 4: Checking Circuit Breaker status\n');

    try {
      const metrics = await axios.get(`${API_GATEWAY}/metrics`);
      console.log('Gateway Metrics:');
      console.log('   Circuit Breaker Status:', metrics.data.circuitBreaker.status);
      console.log('   Stats:', JSON.stringify(metrics.data.circuitBreaker.stats, null, 2));
    } catch (error) {
      console.log('Could not get metrics');
    }

    console.log('\nSTEP 5: Restoring inventory service\n');

    try {
      await axios.post(`${INVENTARIO_SERVICE}/admin/simular-fallo`, {
        activar: false
      });
      console.log('Inventory service RESTORED');
    } catch (error) {
      console.log('Could not restore - may be stopped with Docker');
    }

    console.log('\nSTEP 6: Waiting for Circuit Breaker recovery...\n');
    console.log('Waiting 15 seconds for circuit breaker to close...');

    await sleep(15000);

    console.log('\nSTEP 7: Reservation after recovery\n');

    try {
      const reservaRecuperada = await axios.post(`${API_GATEWAY}/api/reservas`, {
        eventoId: 'evento-3',
        asientos: 1,
        usuario: 'usuario-recuperacion@example.com',
        metodoPago: 'tarjeta'
      });

      console.log('SYSTEM RECOVERED - Successful reservation:', reservaRecuperada.data.reserva.id);
    } catch (error) {
      if (error.response) {
        console.log('System still recovering:', error.response.data.error);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('CONCLUSIONS:');
    console.log('='.repeat(80));
    console.log('\n1. Circuit Breaker detected failure after several attempts');
    console.log('2. System used local cache as fallback (controlled degradation)');
    console.log('3. Users received informative error messages');
    console.log('4. System recovered automatically when service returned');
    console.log('5. NO cascade failure of entire system');
    console.log('\nPattern implemented: Circuit Breaker + Fallback Cache');
    console.log('');

  } catch (error) {
    console.error('\nError executing demo:', error.message);
  }
}

console.log('\nPREREQUISITES:');
console.log('   1. All services must be running (docker-compose up)');
console.log('   2. System must be in initial state\n');
console.log('Starting demo in 3 seconds...\n');

setTimeout(demo, 3000);
