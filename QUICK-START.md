# Inicio Rápido - Sistema de Reservas

## Instalación

```bash
npm install
```

## Iniciar el Sistema

```bash
npm start
```

Este comando iniciará todos los servicios:
- API Gateway (Puerto 3000)
- Servicio de Reservas (Puerto 3001)
- Servicio de Inventario (Puerto 3002)
- Servicio de Pagos (Puerto 3003)
- Servicio de Notificaciones (Puerto 3004)

## Acceder al Panel de Control

Abre tu navegador en:
```
http://localhost:3000
```

## Ejecutar Demos

Desde el panel de control, haz clic en los botones de cada demo:

1. **FALLO #1: Inventario Fantasma** - Circuit Breaker + Cache
2. **FALLO #2: Pasarela Lenta** - Timeout + Async Processing
3. **FALLO #3: Diluvio de Peticiones** - Rate Limiting + Queue
4. **FALLO #4: Condición de Carrera** - Distributed Locks

O ejecuta desde la terminal:

```bash
npm run demo:inventario-caida
npm run demo:pasarela-lenta
npm run demo:diluvio-peticiones
npm run demo:condicion-carrera
```

## Verificar Estado

El panel de control muestra:
- Estado de cada servicio (online/offline)
- Métricas en tiempo real
- Circuit breaker status
- Cola de peticiones
- Logs del sistema

## Detener el Sistema

Presiona `Ctrl+C` en la terminal donde ejecutaste `npm start`

## Requisitos Previos

- Node.js 18+
- Redis (opcional, para distributed locks)

## Arquitectura

```
┌─────────────────┐
│  Panel Web      │ → http://localhost:3000
│  (Frontend)     │
└────────┬────────┘
         │
┌────────▼────────┐
│  API Gateway    │ → Puerto 3000
└────────┬────────┘
         │
    ┌────┴────┬─────────┬──────────┐
    │         │         │          │
┌───▼───┐ ┌──▼───┐ ┌───▼────┐ ┌──▼──────────┐
│Reservas│ │Invent│ │ Pagos  │ │Notificaciones│
│  3001  │ │ 3002 │ │  3003  │ │    3004      │
└────────┘ └──────┘ └────────┘ └──────────────┘
```

## Patrones Implementados

- **Circuit Breaker** (Opossum)
- **Rate Limiting** (express-rate-limit)
- **Bulkhead** (Aislamiento de recursos)
- **Distributed Locks** (Redlock)
- **Retry con Backoff**
- **Timeout Pattern**
- **Cache Fallback**
- **Load Shedding**

## Documentación Completa

Ver [README.md](README.md) para documentación detallada.
