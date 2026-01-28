const axios = require('axios');

const API_GATEWAY = 'http://localhost:3000';
const INVENTARIO_SERVICE = 'http://localhost:3002';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function intentarReserva(usuario, eventoId, asientos = 1) {
  const inicio = Date.now();
  
  console.log(`[${usuario}] Attempting to reserve ${asientos} seat(s)...`);
  
  try {
    const response = await axios.post(`${API_GATEWAY}/api/reservas`, {
      eventoId,
      asientos,
      usuario: `${usuario}@example.com`,
      metodoPago: 'tarjeta'
    }, {
      timeout: 15000
    });
    
    const duracion = ((Date.now() - inicio) / 1000).toFixed(2);
    
    console.log(`[${usuario}] SUCCESSFUL RESERVATION in ${duracion}s`);
    console.log(`   ID: ${response.data.reserva.id}`);
    console.log(`   Status: ${response.data.reserva.estado}`);
    
    return {
      usuario,
      success: true,
      duracion,
      reservaId: response.data.reserva.id,
      data: response.data
    };
    
  } catch (error) {
    const duracion = ((Date.now() - inicio) / 1000).toFixed(2);
    
    if (error.response) {
      console.log(`[${usuario}] FAILED RESERVATION in ${duracion}s`);
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Error: ${error.response.data.error}`);
      console.log(`   Message: ${error.response.data.message || ''}`);
      
      return {
        usuario,
        success: false,
        duracion,
        status: error.response.status,
        error: error.response.data.error
      };
    }
    
    console.log(`[${usuario}] ERROR in ${duracion}s: ${error.message}`);
    
    return {
      usuario,
      success: false,
      duracion,
      error: error.message
    };
  }
}

async function verificarInventario(eventoId) {
  try {
    const response = await axios.get(`${INVENTARIO_SERVICE}/inventario/${eventoId}`);
    return response.data;
  } catch (error) {
    console.log(`Error checking inventory: ${error.message}`);
    return null;
  }
}

async function demo() {
  console.log('\n' + '='.repeat(80));
  console.log('DEMO FAILURE #4: RACE CONDITION');
  console.log('='.repeat(80) + '\n');

  try {
    const eventoTest = 'evento-4';
    
    console.log('STEP 1: Checking event with ONE seat available\n');
    
    const inventarioInicial = await verificarInventario(eventoTest);
    
    if (inventarioInicial) {
      console.log(`Event: ${inventarioInicial.nombre}`);
      console.log(`   Available seats: ${inventarioInicial.asientosDisponibles}`);
      console.log(`   Price: $${inventarioInicial.precio}`);
    }
    
    if (!inventarioInicial || inventarioInicial.asientosDisponibles !== 1) {
      console.log('\nNOTE: Event should have exactly 1 seat for this demo');
    }
    
    await sleep(2000);

    console.log('\nSTEP 2: 5 users attempt to buy the LAST SEAT SIMULTANEOUSLY\n');
    console.log('Without distributed locks, there would be overbooking (race condition)');
    console.log('With Redlock, only ONE should succeed\n');
    
    await sleep(1000);
    
    const usuarios = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];
    
    console.log('Starting requests in PARALLEL...\n');
    
    const promesas = usuarios.map(usuario => 
      intentarReserva(usuario, eventoTest, 1)
    );
    
    const resultados = await Promise.all(promesas);
    
    console.log('\n' + '='.repeat(80));
    console.log('RESULTS ANALYSIS:');
    console.log('='.repeat(80) + '\n');
    
    const exitosas = resultados.filter(r => r.success);
    const fallidas = resultados.filter(r => !r.success);
    
    console.log(`Successful reservations: ${exitosas.length}`);
    console.log(`Failed reservations: ${fallidas.length}\n`);
    
    if (exitosas.length > 0) {
      console.log('WINNERS:');
      exitosas.forEach(r => {
        console.log(`   - ${r.usuario}: Reservation ${r.reservaId} (${r.duracion}s)`);
      });
      console.log('');
    }
    
    if (fallidas.length > 0) {
      console.log('ORDER OF ARRIVAL (losers):');
      fallidas
        .sort((a, b) => parseFloat(a.duracion) - parseFloat(b.duracion))
        .forEach((r, index) => {
          console.log(`   ${index + 1}. ${r.usuario}: ${r.duracion}s - ${r.error}`);
        });
      console.log('');
    }

    console.log('STEP 3: Checking INTEGRITY of inventory\n');
    
    const inventarioFinal = await verificarInventario(eventoTest);
    
    if (inventarioFinal) {
      console.log(`Available seats after reservations: ${inventarioFinal.asientosDisponibles}`);
      
      if (inventarioFinal.asientosDisponibles === 0 && exitosas.length === 1) {
        console.log('SUCCESS: 1 seat sold, 0 available');
        console.log('NO OVERBOOKING - Distributed lock worked correctly');
      } else if (inventarioFinal.asientosDisponibles < 0) {
        console.log('ERROR: OVERBOOKING DETECTED (negative inventory)');
        console.log('   This should NOT occur with distributed locks');
      } else {
        console.log(`Unexpected state: ${exitosas.length} successful, ${inventarioFinal.asientosDisponibles} available`);
      }
    }
    
    await sleep(2000);

    console.log('\nSTEP 4: Explanation of DISTRIBUTED LOCK mechanism\n');
    
    console.log('REDLOCK (Distributed Lock):');
    console.log('   1. User A attempts to reserve → Acquires lock for event');
    console.log('   2. Users B,C,D,E attempt to reserve → WAIT for lock');
    console.log('   3. User A completes purchase → Releases lock');
    console.log('   4. User B acquires lock → Checks availability');
    console.log('   5. No seats → Fails with error 409 (Conflict)');
    console.log('   6. Lock released → Process repeats for C,D,E\n');
    
    console.log('Lock configuration in this system:');
    console.log('   - TTL: 10 seconds (enough to complete transaction)');
    console.log('   - Retry: 10 attempts with 200ms delay');
    console.log('   - Algorithm: Redlock (safe in distributed environments)\n');

    console.log('STEP 5: CONTROL scenario (event with 10 seats)\n');
    console.log('Testing with event that has sufficient seats...\n');
    
    const eventoControl = 'evento-3';
    
    const inventarioControl = await verificarInventario(eventoControl);
    console.log(`Event: ${inventarioControl?.nombre || eventoControl}`);
    console.log(`   Available seats: ${inventarioControl?.asientosDisponibles || 'N/A'}\n`);
    
    const promesasControl = [];
    for (let i = 1; i <= 5; i++) {
      promesasControl.push(intentarReserva(`usuario-control-${i}`, eventoControl, 1));
    }
    
    const resultadosControl = await Promise.all(promesasControl);
    
    const exitosasControl = resultadosControl.filter(r => r.success);
    console.log(`\nWith sufficient seats: ${exitosasControl.length}/5 successful reservations`);
    console.log('   (All should be successful when inventory exists)\n');

    console.log('STEP 6: Demonstration of COMPENSATING TRANSACTION\n');
    console.log('What happens if payment fails after reserving seats:\n');
    console.log('   1. Seats are reserved in inventory');
    console.log('   2. Payment fails');
    console.log('   3. System automatically executes COMPENSATION:');
    console.log('      - Release reserved seats');
    console.log('      - Cancel reservation');
    console.log('      - Return error to user');
    console.log('   4. Inventory returns to consistent state\n');
    
    console.log('   See Reservation Service logs for compensation details');

    console.log('\n' + '='.repeat(80));
    console.log('CONCLUSIONS:');
    console.log('='.repeat(80));
    console.log('\n1. Distributed Lock (Redlock) prevents race conditions');
    console.log('2. Only ONE user can reserve the last seat');
    console.log('3. NO overbooking (inventory never negative)');
    console.log('4. Atomic operations in Redis guarantee consistency');
    console.log('5. Compensating transactions restore state on failure');
    console.log('6. Users receive clear messages about availability');
    console.log('7. System maintains integrity under high concurrency');
    console.log('\nImplemented patterns:');
    console.log('   - Distributed Lock (Redlock)');
    console.log('   - Optimistic Locking (atomic operations)');
    console.log('   - Compensating Transaction (SAGA pattern)');
    console.log('   - Idempotency (same result on multiple attempts)');
    console.log('\nWithout these patterns:');
    console.log('   - Overbooking would occur (2+ users buying 1 seat)');
    console.log('   - Inconsistent inventory (negative seats)');
    console.log('   - Loss of money for company');
    console.log('   - Frustrated customers and manual refunds');
    console.log('');

  } catch (error) {
    console.error('\nError executing demo:', error.message);
  }
}

console.log('\nPREREQUISITES:');
console.log('   1. All services must be running (docker-compose up)');
console.log('   2. Redis must be operational (for distributed locks)');
console.log('   3. evento-4 must have exactly 1 available seat\n');
console.log('Starting demo in 3 seconds...\n');

setTimeout(demo, 3000);
