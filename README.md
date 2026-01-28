# Reservation System with Fault Tolerance

## Description

This project implements a distributed ticket reservation system for events with advanced fault tolerance patterns. The system is designed to handle critical failures without collapsing, maintaining availability and data consistency.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Clients                                │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                     API Gateway                               │
│  • Rate Limiting (100 req/min, 20 req/min for reservations) │
│  • Circuit Breaker                                           │
│  • Bulkhead (50 max connections)                             │
└────────────────────────┬─────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┬──────────────┐
         │               │               │              │
         ▼               ▼               ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  Reservas   │ │ Inventario  │ │   Pagos     │ │Notificaciones│
│             │ │             │ │             │ │             │
│ • Redlock   │ │ • Simulates │ │ • Simulates │ │ • Email/SMS │
│ • Saga      │ │   outage    │ │   latency   │ │             │
│ • Retry     │ │ • Atomic    │ │   (20s)     │ │             │
│             │ │   operations│ │             │ │             │
└──────┬──────┘ └──────┬──────┘ └─────────────┘ └─────────────┘
       │               │
       └───────┬───────┘
               ▼
       ┌─────────────┐
       │    Redis    │
       │  • Storage  │
       │  • Locks    │
       │  • Cache    │
       └─────────────┘
```

## Implemented Failures

### 1. Phantom Inventory (Total Service Outage)
### 2. Slow Gateway (Payment Service Slowness - 20s)
### 3. Request Flood (Gateway Overload)
### 4. Race Condition (Last Seat Purchase)

---

## Installation and Execution

### Prerequisites

- Node.js 18+
- Docker and Docker Compose
- Git

### Installation

```bash
cd SistemadeReservas

npm install

docker-compose up -d

docker-compose logs -f
```

### Run Individual Services (without Docker)

```bash
# Terminal 1 - Redis
docker run -p 6379:6379 redis:7-alpine

# Terminal 2 - API Gateway
npm run start:gateway

# Terminal 3 - Reservations Service
npm run start:reservas

# Terminal 4 - Inventory Service
npm run start:inventario

# Terminal 5 - Payments Service
npm run start:pagos

# Terminal 6 - Notifications Service
npm run start:notificaciones
```

## Running Demos

Each demo simulates and demonstrates a specific failure:

```bash
# Demo 1: Phantom Inventory
npm run demo:inventario-caida

# Demo 2: Slow Gateway
npm run demo:pasarela-lenta

# Demo 3: Request Flood
npm run demo:diluvio-peticiones

# Demo 4: Race Condition
npm run demo:condicion-carrera
```

## Detailed Documentation

See complete documentation for each failure in:
- [Failure #1 - Phantom Inventory](./docs/FALLO-1-INVENTARIO-FANTASMA.md)
- [Failure #2 - Slow Gateway](./docs/FALLO-2-PASARELA-LENTA.md)
- [Failure #3 - Request Flood](./docs/FALLO-3-DILUVIO-PETICIONES.md)
- [Failure #4 - Race Condition](./docs/FALLO-4-CONDICION-CARRERA.md)

## Configuration

### Environment Variables

**API Gateway:**
- `PORT`: Gateway port (default: 3000)
- `REDIS_URL`: Redis URL
- `RESERVAS_URL`: Reservations service URL

**Inventory Service:**
- `SIMULAR_FALLO`: true/false - Simulates service outage

**Payments Service:**
- `SIMULAR_LATENCIA`: true/false - Simulates extreme latency
- `LATENCIA_MS`: Latency milliseconds (default: 20000)

## Main Endpoints

### API Gateway

```
GET    /health                    - Health check
GET    /api/reservas              - List reservations
POST   /api/reservas              - Create reservation
GET    /api/reservas/:id          - Get reservation
GET    /metrics                   - System metrics
```

### Inventory Service

```
GET    /inventario                - List events
GET    /inventario/:eventoId      - Check availability
POST   /inventario/:eventoId/reservar  - Reserve seats
POST   /inventario/:eventoId/liberar   - Release seats
POST   /admin/simular-fallo       - Toggle failure simulation
```

### Payments Service

```
POST   /pagos/procesar            - Process payment
GET    /pagos/transaccion/:id     - Query transaction
POST   /pagos/reembolsar          - Refund payment
POST   /admin/simular-latencia    - Toggle latency simulation
```

## Implemented Resilience Patterns

### Circuit Breaker
- **Library**: Opossum
- **Configuration**: 
  - Timeout: 5 seconds
  - Error threshold: 50%
  - Reset timeout: 10-15 seconds
  - Volume threshold: 3-10 requests

### Retry with Exponential Backoff
- Max 3 retries
- Initial delay: 1 second
- Factor: 2x
- Max delay: 10 seconds

### Bulkhead Pattern
- API Gateway → Reservations: 50 max connections
- Reservations → Payments: 10 max connections

### Rate Limiting
- General: 100 requests/minute per IP
- Reservations: 20 requests/minute per IP
- 60 second sliding window

### Distributed Lock (Redlock)
- TTL: 10 seconds
- Retry: 10 attempts
- Delay: 200ms between attempts
- Jitter: 200ms

## Academic Purpose

This project was developed for the **Distributed Systems** course to demonstrate advanced fault tolerance patterns in microservices architectures.

### Demonstrated Concepts

1. **Graceful Degradation**: System continues functioning (with reduced capacity) when a service fails
2. **Fail Fast**: Quick failure detection to prevent prolonged blocking
3. **Fault Isolation**: One failure doesn't cascade to the entire system
4. **Eventual Consistency**: Maintaining data integrity in distributed environments
5. **Compensating Transactions**: Reverting operations when part of a distributed transaction fails

## Technologies Used

- **Node.js + Express**: Runtime and web framework
- **Redis + ioredis**: Storage and cache
- **Redlock**: Distributed locks
- **Opossum**: Circuit Breaker
- **express-rate-limit**: Rate limiting
- **Axios**: HTTP client
- **Winston**: Structured logging
- **Docker + Docker Compose**: Containerization

## Author

Academic project - Distributed Systems 2026
