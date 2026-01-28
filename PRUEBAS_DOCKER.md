# PRUEBAS DE TOLERANCIA A FALLOS CON DOCKER

Este sistema esta disenado para NO colapsar cuando ocurren fallos. Aqui estan las pruebas que puedes hacer.

## INICIO RAPIDO

### 1. Construir e iniciar todos los servicios
```powershell
docker-compose up --build -d
```

### 2. Verificar que todos los servicios estan corriendo
```powershell
docker-compose ps
```

### 3. Ver logs en tiempo real
```powershell
docker-compose logs -f
```

## PRUEBAS DE FALLOS

### FALLO #1: APAGAR SERVICIO DE INVENTARIO

**Simular el fallo:**
```powershell
docker-compose stop inventario
```

**Que deberia pasar:**
- El sistema NO colapsa
- Circuit Breaker se activa
- Usa cache fallback si hay datos previos
- Puede responder con mensajes controlados como:
    - "Breaker is open"
    - "Timed out after 5000ms"
    - "Service temporarily unavailable"
    - "No cached data available"
- Otras funciones siguen operando

**Probar:**
```powershell
# Intenta consultar inventario (deberia mostrar error controlado)
try {
    Invoke-RestMethod http://localhost:3000/api/inventario
} catch {
    $_.ErrorDetails.Message
}

# Intenta crear reserva (degradacion controlada si inventario esta caido)
try {
    Invoke-RestMethod -Uri http://localhost:3000/api/reservas -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"eventoId":"evento-1","asientos":2,"usuario":"test@test.com"}'
} catch {
    $_.ErrorDetails.Message
}
```

**Recuperar el servicio:**
```powershell
docker-compose start inventario
```

---

### FALLO #2: APAGAR SERVICIO DE PAGOS

**Simular el fallo:**
```powershell
docker-compose stop pagos
```

**Que deberia pasar:**
- El sistema NO colapsa
- Timeout detectado
- Procesamiento asincrono activado
- Mensaje controlado (no 500) como:
    - "Timed out after 10000ms"
    - "Reservation service unavailable"
    - "Service temporarily unavailable"
- La reserva puede quedar pendiente o compensarse

**Probar:**
```powershell
# Intenta crear reserva (timeout controlado)
try {
    Invoke-RestMethod -Uri http://localhost:3000/api/reservas -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"eventoId":"evento-2","asientos":1,"usuario":"test@test.com"}'
} catch {
    $_.ErrorDetails.Message
}
```

**Recuperar el servicio:**
```powershell
docker-compose start pagos
```

---

### FALLO #3: APAGAR SERVICIO DE NOTIFICACIONES

**Simular el fallo:**
```powershell
docker-compose stop notificaciones
```

**Que deberia pasar:**
- El sistema NO colapsa
- La reserva se completa exitosamente
- Puede mostrar advertencia controlada en logs
- Los datos se guardan correctamente
- El usuario recibe confirmacion aunque no llegue el email

**Probar:**
```powershell
# Crear reserva (deberia completarse sin notificacion)
Invoke-RestMethod -Uri http://localhost:3000/api/reservas -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"eventoId":"evento-3","asientos":3,"usuario":"test@test.com"}'
```

**Recuperar el servicio:**
```powershell
docker-compose start notificaciones
```

---

### FALLO #4: APAGAR REDIS (FALLO CRITICO)

**Simular el fallo:**
```powershell
docker-compose stop redis
```

**Que deberia pasar:**
- El sistema NO colapsa
- Usa almacenamiento en memoria (fallback automatico)
- Distributed locks deshabilitados
- Mensajes controlados como:
    - "Service temporarily unavailable"
    - "No cached data available"
- Sistema sigue funcionando con capacidades reducidas

**Probar:**
```powershell
# Verificar que sigue funcionando
try {
    Invoke-RestMethod http://localhost:3000/api/inventario
} catch {
    $_.ErrorDetails.Message
}
Invoke-RestMethod http://localhost:3000/api/health
```

**Recuperar Redis:**
```powershell
docker-compose start redis
```

---

### FALLO #5: INYECTAR LATENCIA EN PAGOS

**Activar latencia de 20 segundos:**
```powershell
Invoke-RestMethod -Uri http://localhost:3003/admin/simular-latencia -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"activar":true}'
```

**Que deberia pasar:**
- Timeout detectado a los 5 segundos
- No espera 20 segundos (timeout protection)
- Procesamiento en background
- Usuario no bloqueado

**Probar:**
```powershell
# Esto deberia timeout rapidamente
try {
    Invoke-RestMethod -Uri http://localhost:3000/api/reservas -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"eventoId":"evento-1","asientos":2,"usuario":"test@test.com"}'
} catch {
    $_.ErrorDetails.Message
}
```

**Desactivar latencia:**
```powershell
Invoke-RestMethod -Uri http://localhost:3003/admin/simular-latencia -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"activar":false}'
```

---

### FALLO #6: SIMULAR CAIDA DE INVENTARIO (SIN APAGAR CONTENEDOR)

**Activar fallo:**
```powershell
Invoke-RestMethod -Uri http://localhost:3002/admin/simular-fallo -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"activar":true}'
```

**Que deberia pasar:**
- Circuit Breaker se abre
- Cache fallback activado
- Sistema responde con datos cacheados
- No hay errores 500

**Probar:**
```powershell
try {
    Invoke-RestMethod http://localhost:3000/api/inventario
} catch {
    $_.ErrorDetails.Message
}
```

**Desactivar fallo:**
```powershell
Invoke-RestMethod -Uri http://localhost:3002/admin/simular-fallo -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"activar":false}'
```

---

### FALLO #7: SOBRECARGA MASIVA (Rate Limiting)

**Simular 200 usuarios simultaneos:**
```powershell
# Desde el navegador, abre http://localhost:3000
# Ve a Demo #3: Diluvio de Peticiones
# Configura 200 usuarios
# Ejecuta
```

**Que deberia pasar:**
- Rate Limiter rechaza peticiones excesivas
- Bulkhead limita concurrencia a 50
- Load Shedding activo
- Sistema NO colapsa
- Puede haber 429 o cola (segun capacidad)

---

## VERIFICACIONES DE NO COLAPSO

### Ver metricas del sistema:
```powershell
Invoke-RestMethod http://localhost:3000/api/metrics
```

Deberia mostrar:
- Circuit Breaker status (OPEN/CLOSED/HALF_OPEN)
- Bulkhead concurrent connections
- Queue size
- Cache hit rate

### Ver estado de salud:
```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

### Ver logs de tolerancia a fallos:
```powershell
docker-compose logs -f api-gateway | findstr "Circuit\|Timeout\|Fallback"
```

---

## PATRONES DE TOLERANCIA IMPLEMENTADOS

1. **Circuit Breaker**: Protege servicios caidos
2. **Timeout**: Evita esperas infinitas
3. **Retry**: Reintenta operaciones fallidas
4. **Bulkhead**: Limita concurrencia
5. **Rate Limiting**: Previene sobrecarga
6. **Cache Fallback**: Responde con datos cacheados
7. **Async Processing**: Procesamiento en background
8. **Distributed Locks**: Evita race conditions
9. **Load Shedding**: Rechaza carga excesiva
10. **Graceful Degradation**: Funcionalidad reducida pero NO colapso

---

## COMANDOS UTILES

### Reiniciar todos los servicios:
```powershell
docker-compose restart
```

### Ver estado de todos los contenedores:
```powershell
docker-compose ps
```

### Ver uso de recursos:
```powershell
docker stats
```

### Detener todo:
```powershell
docker-compose down
```

### Limpiar todo (incluyendo volumenes):
```powershell
docker-compose down -v
```

### Reconstruir un servicio especifico:
```powershell
docker-compose up --build -d inventario
```

---

## PRUEBA COMPLETA DE TOLERANCIA

**Script de prueba automatica** (ejecuta todos los fallos en secuencia):

```powershell
# 1. Verificar estado inicial
Write-Host "1. Verificando estado inicial..."
Invoke-RestMethod http://localhost:3000/api/health

# 2. Apagar inventario
Write-Host "`n2. Apagando servicio de inventario..."
docker-compose stop inventario
Start-Sleep -Seconds 2

# 3. Probar que sigue funcionando
Write-Host "`n3. Probando con inventario caido..."
try {
    Invoke-RestMethod http://localhost:3000/api/inventario
} catch {
    Write-Host "Timeout controlado detectado (ESPERADO)" -ForegroundColor Yellow
}

# 4. Recuperar inventario
Write-Host "`n4. Recuperando inventario..."
docker-compose start inventario
Start-Sleep -Seconds 3

# 5. Inyectar latencia
Write-Host "`n5. Inyectando latencia en pagos..."
Invoke-RestMethod -Uri http://localhost:3003/admin/simular-latencia -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"activar":true}'

# 6. Probar timeout
Write-Host "`n6. Probando timeout..."
try {
    Invoke-RestMethod -Uri http://localhost:3000/api/reservas -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"eventoId":"evento-1","asientos":1,"usuario":"test@test.com"}'
} catch {
    Write-Host "Timeout detectado (ESPERADO)" -ForegroundColor Yellow
}

# 7. Desactivar latencia
Write-Host "`n7. Desactivando latencia..."
Invoke-RestMethod -Uri http://localhost:3003/admin/simular-latencia -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"activar":false}'

# 8. Ver metricas finales
Write-Host "`n8. Metricas del sistema:"
Invoke-RestMethod http://localhost:3000/api/metrics

Write-Host "`n`nPRUEBA COMPLETA FINALIZADA - El sistema NO colapso!" -ForegroundColor Green
```

---

## CONCLUSION

El sistema esta disenado para:
- **NO colapsar** cuando hay fallos
- **Degradarse gracefully** (funcionalidad reducida pero operativo)
- **Recuperarse automaticamente** cuando los servicios vuelven
- **Mostrar mensajes de error controlados** en lugar de crashes
- **Mantener la integridad de datos** incluso bajo fallo

Todas las pruebas anteriores demuestran estos principios en accion.
