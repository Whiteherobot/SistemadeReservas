#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('\n===========================================');
console.log('  Sistema de Reservas - Tolerancia a Fallos');
console.log('===========================================\n');

const services = [
  { name: 'API Gateway', command: 'node', args: ['services/api-gateway/index.js'], color: '\x1b[36m' },
  { name: 'Reservas', command: 'node', args: ['services/reservas/index.js'], color: '\x1b[32m' },
  { name: 'Inventario', command: 'node', args: ['services/inventario/index.js'], color: '\x1b[33m' },
  { name: 'Pagos', command: 'node', args: ['services/pagos/index.js'], color: '\x1b[35m' },
  { name: 'Notificaciones', command: 'node', args: ['services/notificaciones/index.js'], color: '\x1b[34m' }
];

const processes = [];

function startService(service) {
  const proc = spawn(service.command, service.args, {
    cwd: __dirname,
    stdio: 'pipe'
  });

  proc.stdout.on('data', (data) => {
    console.log(`${service.color}[${service.name}]\x1b[0m ${data.toString().trim()}`);
  });

  proc.stderr.on('data', (data) => {
    console.error(`${service.color}[${service.name}]\x1b[0m \x1b[31m${data.toString().trim()}\x1b[0m`);
  });

  proc.on('close', (code) => {
    console.log(`${service.color}[${service.name}]\x1b[0m Process exited with code ${code}`);
  });

  processes.push(proc);
}

console.log('Iniciando servicios...\n');

services.forEach((service, index) => {
  setTimeout(() => {
    console.log(`Iniciando ${service.name}...`);
    startService(service);
  }, index * 1000);
});

setTimeout(() => {
  console.log('\n===========================================');
  console.log('  Todos los servicios iniciados');
  console.log('===========================================');
  console.log('\nPanel de Control: http://localhost:3000');
  console.log('API Gateway: http://localhost:3000/api');
  console.log('\nPresiona Ctrl+C para detener todos los servicios\n');
}, services.length * 1000 + 2000);

process.on('SIGINT', () => {
  console.log('\n\nDeteniendo servicios...');
  processes.forEach(proc => proc.kill());
  setTimeout(() => {
    console.log('Todos los servicios detenidos');
    process.exit(0);
  }, 1000);
});
