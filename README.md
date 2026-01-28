#  Sistema de Reservas con Tolerancia a Fallos

##  Descripción

Este es un **sistema distribuido de reserva de entradas** para eventos implementado con patrones avanzados de **tolerancia a fallos y resiliencia**. El sistema está diseñado para manejar fallos críticos sin colapsar, manteniendo alta disponibilidad y consistencia de datos incluso bajo condiciones adversas.

###  Objetivo
Demostrar cómo construir sistemas robustos en microservicios que sigan siendo funcionales cuando diferentes componentes fallan.

##  Inicio Rapido

### Opcion 1: Docker (RECOMENDADO para pruebas de fallos)

```powershell
# 1. Construir e iniciar todos los servicios
docker-compose up --build -d

# 2. Acceder al panel web
# Abre http://localhost:3000 en tu navegador

# 3. Ejecutar script de pruebas automaticas
.\test-fallos.ps1

# 4. Ver documentacion completa de pruebas
# Lee PRUEBAS_DOCKER.md
```

### Opcion 2: Ejecucion Local

```powershell
# 1. Instalar dependencias
npm install

# 2. Iniciar todos los servicios
npm start

# 3. Acceder al panel web
# Abre http://localhost:3000 en tu navegador
```

##  Arquitectura

```
┌──────────────────────────────────────────────────────────────┐
│                    🖥️ Clientes Web                            │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                   🚪 API Gateway                              │
│  ✓ Rate Limiting (100 req/min, 20 req/min para reservas)    │
│  ✓ Circuit Breaker                                          │
│  ✓ Bulkhead (50 conexiones máximas)                         │
└────────────────────────┬─────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┬──────────────┐
         │               │               │              │
         ▼               ▼               ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  📅 Reservas │ │ 📊 Inventario│ │ 💳 Pagos    │ │📬Notificaciones│
│             │ │             │ │             │ │             │
│ • Redlock   │ │ • Simula    │ │ • Simula    │ │ • Email/SMS │
│ • Saga      │ │   caída     │ │   latencia  │ │             │
│ • Retry     │ │ • Operaciones│ │   (20s)    │ │             │
│             │ │   atómicas  │ │             │ │             │
└──────┬──────┘ └──────┬──────┘ └─────────────┘ └─────────────┘
       │               │
       └───────┬───────┘
               ▼
       ┌─────────────────┐
       │   📦 Redis      │
       │  • Almacenamiento │
       │  • Locks          │
       │  • Caché          │
       └─────────────────┘
```

### Componentes

| Servicio | Puerto | Función |
|----------|--------|---------|
| **API Gateway** | 3000 | Enrutador central, limitación de tasa, protección |
| **Reservas** | 3001 | Gestión de reservas y transacciones |
| **Inventario** | 3002 | Control de disponibilidad de asientos |
| **Pagos** | 3003 | Procesamiento de pagos |
| **Notificaciones** | 3004 | Envío de confirmaciones (simulado) |
| **Redis** | 6379 | Base de datos distribuida, locks, caché |

##  Fallos Implementados

El sistema simula y gestiona 4 escenarios críticos de fallo:

| # | Fallo | Síntoma | Patrón Aplicado |
|---|-------|---------|-----------------|
| 1️⃣ | **Inventario Fantasma** | El servicio de inventario cae completamente | Circuit Breaker + Timeout |
| 2️⃣ | **Pasarela Lenta** | El servicio de pagos responde en 20 segundos | Timeout + Bulkhead |
| 3️⃣ | **Diluvio de Peticiones** | Sobrecarga del API Gateway | Rate Limiting + Bulkhead |
| 4️⃣ | **Condición de Carrera** | Múltiples usuarios compran el último asiento | Redlock Distribuido |

Cada fallo tiene su **documentación detallada** en la carpeta `docs/` con explicaciones técnicas y soluciones.
##  Instalación y Ejecución

###  Requisitos Previos

- **Node.js** 18 o superior
- **Docker** y **Docker Compose**
- **Git**

###  Instalación Rápida (Con Docker)

```bash
# 1. Clonar el repositorio
git clone <repo-url>
cd SistemadeReservas

# 2. Instalar dependencias
npm install

# 3. Iniciar todos los servicios
docker-compose up -d

# 4. Ver logs en tiempo real
docker-compose logs -f
```

**El sistema estará disponible en** `http://localhost:3000`

###  Ejecución Manual (Sin Docker)

Si prefieres ejecutar cada servicio en una terminal separada:

```bash
# Terminal 1 - Redis
docker run -p 6379:6379 redis:7-alpine

# Terminal 2 - API Gateway
npm run start:gateway

# Terminal 3 - Servicio de Reservas
npm run start:reservas

# Terminal 4 - Servicio de Inventario
npm run start:inventario

# Terminal 5 - Servicio de Pagos
npm run start:pagos

# Terminal 6 - Servicio de Notificaciones
npm run start:notificaciones
```

###  Ver Métricas y Estado
```bash
# Estado del sistema
curl http://localhost:3000/health

# Métricas del API Gateway
curl http://localhost:3000/metrics
```

##  Ejecución de Demos

Cada demo simula un fallo específico y demuestra cómo el sistema sigue funcionando:

### Demo 1️ - Inventario Fantasma
Simula la **caída completa del servicio de inventario**.
```bash
npm run demo:inventario-caida
```
**Aprenderás:** Cómo el Circuit Breaker previene fallos en cascada.

### Demo 2️ - Pasarela Lenta
Simula el servicio de pagos respondiendo en **20 segundos**.
```bash
npm run demo:pasarela-lenta
```
**Aprenderás:** Cómo el Timeout y Retry manejan servicios lentos.

### Demo 3️ - Diluvio de Peticiones
Simula **100+ peticiones simultáneas** al API Gateway.
```bash
npm run demo:diluvio-peticiones
```
**Aprenderás:** Cómo Rate Limiting y Bulkhead protegen el sistema.

### Demo 4️ - Condición de Carrera
Múltiples usuarios intentan comprar el **último asiento**.
```bash
npm run demo:condicion-carrera
```
**Aprenderás:** Cómo Redlock garantiza transacciones seguras.

---

**  Documentación Detallada de Cada Fallo:**
- [Fallo #1 - Inventario Fantasma](docs/FALLO-1-INVENTARIO-FANTASMA.md)
- [Fallo #2 - Pasarela Lenta](docs/FALLO-2-PASARELA-LENTA.md)
- [Fallo #3 - Diluvio de Peticiones](docs/FALLO-3-DILUVIO-PETICIONES.md)
- [Fallo #4 - Condición de Carrera](docs/FALLO-4-CONDICION-CARRERA.md)

##  Configuración

### Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# API Gateway
API_GATEWAY_PORT=3000
REDIS_URL=redis://localhost:6379

# Servicio de Inventario
INVENTARIO_PORT=3002
SIMULAR_FALLO=false                    # true para activar caída simulada

# Servicio de Pagos
PAGOS_PORT=3003
SIMULAR_LATENCIA=false                 # true para activar latencia simulada
LATENCIA_MS=20000                      # Milisegundos de latencia

# Servicio de Reservas
RESERVAS_PORT=3001
```

### Configuración de Patrones

Cada patrón se puede ajustar en `shared/resilience-patterns.js`:

- **Circuit Breaker:** Timeout, umbral de errores, tiempo de reinicio
- **Rate Limiting:** Límite de peticiones, ventana de tiempo
- **Bulkhead:** Conexiones máximas por servicio
- **Redlock:** TTL, reintentos, retardo

##  API REST - Endpoints Principales

###  API Gateway (`localhost:3000`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/health` | Verificación de salud del sistema |
| GET | `/metrics` | Métricas y estadísticas en tiempo real |
| GET | `/api/reservas` | Listar todas las reservas |
| POST | `/api/reservas` | Crear una nueva reserva |
| GET | `/api/reservas/:id` | Obtener detalles de una reserva |
| DELETE | `/api/reservas/:id` | Cancelar una reserva |

###  Servicio de Reservas (`localhost:3001`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/reservas` | Listar reservas |
| POST | `/reservas` | Crear reserva (requiere lock distribuido) |
| GET | `/reservas/:id` | Obtener detalles |
| DELETE | `/reservas/:id` | Cancelar reserva |

###  Servicio de Inventario (`localhost:3002`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/inventario` | Listar eventos |
| GET | `/inventario/:eventoId` | Consultar disponibilidad |
| POST | `/inventario/:eventoId/reservar` | Reservar asientos |
| POST | `/inventario/:eventoId/liberar` | Liberar asientos |
| POST | `/admin/simular-fallo` | Activar/desactivar simulación |

###  Servicio de Pagos (`localhost:3003`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/pagos/procesar` | Procesar pago |
| GET | `/pagos/transaccion/:id` | Consultar transacción |
| POST | `/pagos/reembolsar` | Reembolsar pago |
| POST | `/admin/simular-latencia` | Activar/desactivar simulación |

###  Servicio de Notificaciones (`localhost:3004`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/notificaciones/enviar` | Enviar notificación |
| GET | `/notificaciones/historial` | Ver historial de envíos |

##  Patrones de Resiliencia Implementados

### 1️ Circuit Breaker
**Propósito:** Evitar llamadas a servicios que están caídos.

- **Librería:** Opossum
- **Timeout:** 5 segundos
- **Umbral de error:** 50% de fallos
- **Tiempo de reinicio:** 10-15 segundos
- **Volumen mínimo:** 3-10 solicitudes antes de abrir el circuito

**Ejemplo de uso:**
```javascript
const breaker = new CircuitBreaker(fetchData, {
  timeout: 5000,
  errorThresholdPercentage: 50
});
```

### 2️ Retry con Backoff Exponencial
**Propósito:** Reintentar peticiones fallidas con espera creciente.

- **Máximo de intentos:** 3 reintentos
- **Retraso inicial:** 1 segundo
- **Factor exponencial:** 2x
- **Retraso máximo:** 10 segundos

**Secuencia:** 1s → 2s → 4s → Fallo final

### 3️ Bulkhead (Aislamiento de Recursos)
**Propósito:** Limitar conexiones simultáneas para evitar saturación.

- **API Gateway → Reservas:** 50 conexiones máximas
- **Reservas → Pagos:** 10 conexiones máximas

### 4️ Rate Limiting (Limitación de Tasa)
**Propósito:** Proteger el sistema de abuso y sobrecarga.

- **Límite general:** 100 solicitudes/minuto por IP
- **Límite de reservas:** 20 solicitudes/minuto por IP
- **Ventana:** Deslizante de 60 segundos

### 5️ Lock Distribuido (Redlock)
**Propósito:** Garantizar exclusividad en transacciones críticas.

- **TTL:** 10 segundos
- **Reintentos:** 10 intentos
- **Retardo base:** 200ms
- **Jitter:** ±200ms (aleatoriedad)

**Usado en:** Reservas de últimos asientos, evita race conditions.

### 6️ Patrón Saga
**Propósito:** Coordinar transacciones distribuidas entre servicios.

- **Compensación automática:** Si un paso falla, se revierten los anteriores
- **Secuencia:** Reserva → Pago → Notificación
- **Rollback en cascada:** Si pago falla, se libera la reserva

##  Conceptos Clave Demostrados

| Concepto | Definición | Ejemplo en el Sistema |
|----------|-----------|----------------------|
| **Degradación Controlada** | El sistema sigue funcionando (con capacidad reducida) cuando falla un componente | Si pagos cae, se pone en cola la transacción |
| **Fail Fast** | Detección rápida de fallos para evitar bloqueos prolongados | Circuit Breaker abre inmediatamente tras 50% de errores |
| **Aislamiento de Fallos** | Un fallo no se propaga a todo el sistema | Bulkhead limita conexiones para evitar cascada |
| **Consistencia Eventual** | Integridad de datos en entornos distribuidos | Saga asegura que todas las operaciones se completen o revierten |
| **Transacciones Compensatorias** | Reversión automática de operaciones fallidas | Si pago falla, se libera automáticamente el asiento reservado |

---

##  Testing y Monitoreo

### Verificar Salud del Sistema
```bash
curl http://localhost:3000/health
```

**Respuesta esperada:**
```json
{
  "status": "healthy",
  "services": {
    "reservas": "up",
    "inventario": "up",
    "pagos": "up",
    "notificaciones": "up"
  },
  "timestamp": "2026-01-28T10:30:00Z"
}
```

### Ver Métricas en Tiempo Real
```bash
curl http://localhost:3000/metrics
```

Muestra estadísticas de Rate Limiting, Circuit Breakers abiertos, y latencias.

### Limpiar Docker
```bash
# Detener todos los servicios
docker-compose down

# Eliminar volúmenes (borrar datos)
docker-compose down -v

# Ver logs de un servicio específico
docker-compose logs -f reservas
```

---

##  Pruebas de Tolerancia a Fallos

El sistema esta disenado para **NO colapsar** cuando ocurren fallos. Puedes probarlo de 2 formas:

### Opcion 1: Script Automatico (Recomendado)

```powershell
# Ejecutar todas las pruebas automaticamente
.\test-fallos.ps1
```

Este script prueba:
- Apagar servicio de inventario (Circuit Breaker + Cache Fallback)
- Inyectar latencia en pagos (Timeout Detection)
- Apagar Redis (Fallback a memoria)
- Ver metricas del sistema

### Opcion 2: Pruebas Manuales

```powershell
# 1. Apagar servicio de inventario
docker stop reservas-inventario

# 2. Probar que sigue funcionando
curl http://localhost:3000/api/inventario
# Deberia responder con cache, NO error 500

# 3. Recuperar servicio
docker start reservas-inventario
```

### Opcion 3: Interfaz Web Interactiva

1. Abre http://localhost:3000
2. Ve a las demos interactivas
3. Configura parametros (usuarios, eventos, asientos)
4. Ejecuta y observa los logs en tiempo real

### Documentacion Completa de Pruebas

Consulta `PRUEBAS_DOCKER.md` para ver:
- 7 escenarios de fallo diferentes
- Comandos exactos para cada prueba
- Que deberia pasar en cada caso
- Como verificar que NO colapsa
- Lista de patrones activados

---

##  Stack Tecnológico

| Tecnología | Propósito |
|-----------|----------|
| **Node.js + Express** | Runtime y framework web |
| **Redis + ioredis** | Almacenamiento distribuido y caché |
| **Redlock** | Locks distribuidos |
| **Opossum** | Circuit Breaker |
| **express-rate-limit** | Rate limiting |
| **Axios** | Cliente HTTP |
| **Winston** | Logging estructurado |
| **Docker** | Contenerización |
| **Docker Compose** | Orquestación local |

---

##  Estructura del Proyecto

```
📦 SistemadeReservas
├── 📄 docker-compose.yml          # Configuración de servicios
├── 📄 package.json                # Dependencias del proyecto
├── 📄 start.js                    # Script de inicio
├── 📂 services/                   # Microservicios
│   ├── api-gateway/               # Router central (puerto 3000)
│   ├── reservas/                  # Gestión de reservas (puerto 3001)
│   ├── inventario/                # Control de inventario (puerto 3002)
│   ├── pagos/                     # Procesamiento de pagos (puerto 3003)
│   └── notificaciones/            # Notificaciones (puerto 3004)
├── 📂 shared/                     # Código compartido
│   ├── logger.js                  # Utilidades de logging
│   └── resilience-patterns.js    # Patrones de resiliencia
├── 📂 demos/                      # Demostraciones de fallos
│   ├── demo-inventario-fantasma.js
│   ├── demo-pasarela-lenta.js
│   ├── demo-diluvio-peticiones.js
│   └── demo-condicion-carrera.js
├── 📂 docs/                       # Documentación detallada
│   ├── FALLO-1-INVENTARIO-FANTASMA.md
│   ├── FALLO-2-PASARELA-LENTA.md
│   ├── FALLO-3-DILUVIO-PETICIONES.md
│   └── FALLO-4-CONDICION-CARRERA.md
└── 📂 public/                     # Interfaz web (HTML/CSS/JS)
```

---

##  Propósito Académico

Este proyecto fue desarrollado para la asignatura **Sistemas Distribuidos** con el objetivo de demostrar patrones avanzados de tolerancia a fallos en arquitecturas de microservicios. Es una herramienta educativa para entender cómo construir sistemas resilientes y confiables.

### Objetivos de Aprendizaje
✅ Comprender fallos comunes en sistemas distribuidos  
✅ Implementar patrones de resiliencia en la práctica  
✅ Diseñar sistemas que degrade gracefully ante fallos  
✅ Usar locks distribuidos para sincronización  
✅ Coordinar transacciones entre múltiples servicios  

---

##  Solución de Problemas

| Problema | Solución |
|----------|----------|
| **Puerto ya en uso** | `lsof -i :3000` y `kill -9 <PID>` (macOS/Linux) o usar Task Manager (Windows) |
| **Redis no conecta** | Verificar que Redis corre: `redis-cli ping` debe responder con `PONG` |
| **Servicios no arrancan** | Ver logs: `docker-compose logs` o ejecutar sin Docker: `npm run start:gateway` |
| **Circuit Breaker abierto** | Esperar 10-15 segundos o reiniciar el servicio fallido |

---

##  Lectura Recomendada

- [Designing Resilient Systems](https://www.oreilly.com/library/view/) - O'Reilly
- [Building Microservices](https://www.oreilly.com/library/view/) - Sam Newman
- [Release It!](https://pragprog.com/titles/mnee2/release-it-second-edition/) - Michael Nygard
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html) - Martin Fowler

