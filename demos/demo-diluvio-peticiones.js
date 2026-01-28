const axios = require('axios');

const API_GATEWAY = 'http://localhost:3000';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function enviarPeticion(id, endpoint, data) {
  const inicio = Date.now();
  
  try {
    const response = await axios.post(`${API_GATEWAY}${endpoint}`, data, {
      timeout: 5000
    });
    
    const duracion = Date.now() - inicio;
    return {
      id,
      success: true,
      status: response.status,
      duracion,
      data: response.data
    };
    
  } catch (error) {
    const duracion = Date.now() - inicio;
    
    return {
      id,
      success: false,
      status: error.response?.status || 0,
      duracion,
      error: error.response?.data?.error || error.message,
      retryAfter: error.response?.data?.retryAfter
    };
  }
}

async function diluvio(cantidad, endpoint, getData) {
  console.log(`\nSending ${cantidad} simultaneous requests to ${endpoint}...\n`);
  
  const promesas = [];
  const inicio = Date.now();
  
  for (let i = 1; i <= cantidad; i++) {
    promesas.push(enviarPeticion(i, endpoint, getData(i)));
  }
  
  const resultados = await Promise.all(promesas);
  const duracionTotal = ((Date.now() - inicio) / 1000).toFixed(2);
  
  const exitosas = resultados.filter(r => r.success);
  const rateLimited = resultados.filter(r => r.status === 429);
  const errores = resultados.filter(r => !r.success && r.status !== 429);
  
  console.log('RESULTS:');
  console.log(`   Successful: ${exitosas.length}/${cantidad}`);
  console.log(`   Rate Limited (429): ${rateLimited.length}/${cantidad}`);
  console.log(`   Other errors: ${errores.length}/${cantidad}`);
  console.log(`   Total time: ${duracionTotal}s`);
  
  if (rateLimited.length > 0) {
    console.log(`   Retry After: ${rateLimited[0].retryAfter} seconds`);
  }
  
  if (exitosas.length > 0) {
    console.log(`\n   Example successful request (#${exitosas[0].id}):`);
    console.log(`      Status: ${exitosas[0].status}`);
    console.log(`      Duration: ${exitosas[0].duracion}ms`);
  }
  
  if (rateLimited.length > 0) {
    console.log(`\n   Example blocked request (#${rateLimited[0].id}):`);
    console.log(`      Status: ${rateLimited[0].status}`);
    console.log(`      Error: ${rateLimited[0].error}`);
    console.log(`      Duration: ${rateLimited[0].duracion}ms`);
  }
  
  return resultados;
}

async function demo() {
  console.log('\n' + '='.repeat(80));
  console.log('DEMO FAILURE #3: REQUEST FLOOD');
  console.log('='.repeat(80) + '\n');

  try {
    console.log('STEP 1: Normal system usage (10 requests)\n');
    
    await diluvio(10, '/api/reservas', (i) => ({
      eventoId: 'evento-1',
      asientos: 1,
      usuario: `usuario-normal-${i}@example.com`,
      metodoPago: 'tarjeta'
    }));
    
    await sleep(2000);

    console.log('\nSTEP 2: Exceeding GENERAL RATE LIMIT (100 req/min)\n');
    console.log('Sending 150 requests to exceed 100/minute limit...');
    
    await diluvio(150, '/api/reservas', (i) => ({
      eventoId: `evento-${(i % 3) + 1}`,
      asientos: 1,
      usuario: `usuario-flood-${i}@example.com`,
      metodoPago: 'tarjeta'
    }));
    
    await sleep(3000);

    console.log('\nSTEP 3: Exceeding STRICT RESERVATION RATE LIMIT (20 req/min)\n');
    console.log('Sending 50 reservation requests to exceed 20/minute limit...');
    
    await diluvio(50, '/api/reservas', (i) => ({
      eventoId: 'evento-2',
      asientos: 1,
      usuario: `usuario-strict-${i}@example.com`,
      metodoPago: 'tarjeta'
    }));
    
    await sleep(2000);

    console.log('\nSTEP 4: Checking Bulkhead status\n');
    
    const health = await axios.get(`${API_GATEWAY}/health`);
    console.log('Bulkhead Status:');
    console.log(`   Concurrent connections: ${health.data.bulkhead.concurrent}/${health.data.bulkhead.max}`);
    console.log(`   Queued requests: ${health.data.bulkhead.queued}`);
    
    await sleep(2000);

    console.log('\nSTEP 5: Simulating DDoS ATTACK (200 simultaneous requests)\n');
    console.log('System should reject most and maintain stability...');
    
    const inicioAtaque = Date.now();
    
    await diluvio(200, '/api/reservas', (i) => ({
      eventoId: `evento-${(i % 4) + 1}`,
      asientos: Math.floor(Math.random() * 3) + 1,
      usuario: `atacante-${i}@malicious.com`,
      metodoPago: 'tarjeta'
    }));
    
    const duracionAtaque = ((Date.now() - inicioAtaque) / 1000).toFixed(2);
    
    console.log(`\nAttack completed in ${duracionAtaque}s`);
    console.log('   System should have rejected most requests');
    
    await sleep(2000);

    console.log('\nSTEP 6: Verifying system is OPERATIONAL after attack\n');
    
    console.log('Waiting 10 seconds for rate limiter to partially reset...');
    await sleep(10000);
    
    console.log('\nAttempting normal reservation...');
    
    try {
      const response = await axios.post(`${API_GATEWAY}/api/reservas`, {
        eventoId: 'evento-3',
        asientos: 1,
        usuario: 'usuario-post-ataque@example.com',
        metodoPago: 'tarjeta'
      });
      
      console.log('SYSTEM OPERATIONAL - Successful reservation:', response.data.reserva.id);
      console.log('   System recovered and continues processing legitimate requests');
      
    } catch (error) {
      if (error.response?.status === 429) {
        console.log('Rate limit still active - waiting for full reset (60s)');
      } else {
        console.log('Error:', error.response?.data?.error || error.message);
      }
    }

    console.log('\nSTEP 7: Final system metrics\n');
    
    try {
      const metrics = await axios.get(`${API_GATEWAY}/metrics`);
      console.log('Gateway Status:');
      console.log(JSON.stringify(metrics.data, null, 2));
    } catch (error) {
      console.log('Could not get complete metrics');
    }

    console.log('\n' + '='.repeat(80));
    console.log('CONCLUSIONS:');
    console.log('='.repeat(80));
    console.log('\n1. Rate Limiting protects against excessive use (100 req/min general)');
    console.log('2. Strict Rate Limiting protects critical endpoints (20 req/min reservations)');
    console.log('3. System rejects excess requests with code 429');
    console.log('4. Bulkhead limits concurrency to protect resources');
    console.log('5. System does NOT collapse under simulated DDoS attacks');
    console.log('6. Legitimate users can use system after attack');
    console.log('7. Time windows reset automatically');
    console.log('\nPatterns implemented: Rate Limiting + Bulkhead + Circuit Breaker');
    console.log('\nIn production, would add:');
    console.log('   - WAF (Web Application Firewall)');
    console.log('   - Automatic IP Blacklisting');
    console.log('   - CAPTCHA for suspicious traffic');
    console.log('   - CDN with DDoS protection');
    console.log('');

  } catch (error) {
    console.error('\nError executing demo:', error.message);
  }
}

console.log('\nPREREQUISITES:');
console.log('   1. All services must be running (docker-compose up)');
console.log('   2. System must be in initial state');
console.log('   3. This demo will take approximately 1-2 minutes');
console.log('\nWARNING:');
console.log('   This demo generates heavy traffic. Do not run in production.\n');
console.log('Starting demo in 3 seconds...\n');

setTimeout(demo, 3000);
