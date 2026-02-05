# COG WORK LOG

Panel de administración y operación para estaciones de servicio (gasolineras), con frontend en HTML/CSS/JS y backend en Node.js/Express que guarda los datos en archivos JSON.

Este archivo sirve como guía rápida para que **otra persona** pueda levantar el proyecto en su propia computadora.

---

## Requisitos

- Windows, macOS o Linux.
- Node.js instalado (versión LTS recomendada):
  - https://nodejs.org

---

## Instalación

1. Descomprimir la carpeta del proyecto (por ejemplo, en Escritorio o Documentos).
2. Abrir una terminal dentro de la carpeta `backend` del proyecto.
   - En Windows: puedes usar PowerShell y ejecutar:
     - `cd "RUTA/COG WORK LOG/backend"`
3. Instalar dependencias del backend:
   - `npm install`

Opcional pero recomendado:

4. Generar datos demo (historial de ~2 años):
   - `node generate-history.js`

---

## Ejecutar el servidor

1. Desde la carpeta `backend`, iniciar el servidor:
   - `npm start`
2. Dejar esa terminal abierta mientras se usa el sistema.

---

## Abrir la aplicación en el navegador

Con el servidor corriendo, abrir en el navegador (en la misma máquina):

- Login: `http://localhost:3001/login.html`
- Panel administrador: `http://localhost:3001/admin.html`
- Panel operadores: `http://localhost:3001/index.html`

### Usuarios de prueba

Por ejemplo:

- Usuario: `admin`
- Contraseña: `admin123`

---

## Probar desde otro dispositivo en la misma red (opcional)

Para acceder desde celular, tablet u otra laptop **en la misma red WiFi**:

1. Asegúrate de que el servidor (`npm start`) está corriendo en la computadora que tiene el proyecto.
2. En esa misma computadora, obtener la IP local:
   - En Windows: ejecutar en PowerShell `ipconfig` y usar la dirección IPv4 de la Wi-Fi, por ejemplo `192.168.1.72`.
3. En el otro dispositivo (celular, tablet, otra laptop), conectado a la misma WiFi, abrir en el navegador:
   - `http://TU_IP_LOCAL:3001/login.html`
   - `http://TU_IP_LOCAL:3001/admin.html`
   - `http://TU_IP_LOCAL:3001/index.html`

Sustituye `TU_IP_LOCAL` por la IP real (por ejemplo `192.168.1.72`).

---

## Notas

- Los datos se guardan en los archivos JSON dentro de la carpeta `backend` (por ejemplo `admin-data.json`, `operations-data.json`, `users.json`).
- Si `node generate-history.js` no se ejecuta, el sistema seguirá funcionando, pero con menos datos de ejemplo.

---

## Guía rápida por rol (uso diario)

### Administrador

- [ ] Iniciar sesión con usuario de administrador.
- [ ] Ir a "Usuarios" y:
   - [ ] Crear usuarios reales (rol, estación, área, contraseña).
   - [ ] Probar filtro por búsqueda y rol.
   - [ ] Probar "Resetear contraseña seleccionada".
- [ ] Ir a "Estaciones" y:
   - [ ] Registrar todas las estaciones activas.
   - [ ] Verificar que aparezcan en formularios (logs, tareas, reportes).
- [ ] Ir a "Reporte mensual" y:
   - [ ] Seleccionar estación y mes de prueba.
   - [ ] Revisar tarjetas de totales e incidentes.
   - [ ] Exportar CSV y revisar secciones (general, pipas, usuarios, estaciones).
- [ ] Ir a "Mi perfil" y:
   - [ ] Actualizar datos personales (correo, teléfono, foto).
   - [ ] Cambiar contraseña y confirmar que ya no aparece aviso de caducidad.

### Jefe de estación

- [ ] Iniciar sesión con rol "Jefe de estación".
- [ ] En panel operativo:
   - [ ] Revisar "Inicio" (resumen de tareas y calendario).
   - [ ] Ir a "Mi equipo" y confirmar que ve solo su gente.
   - [ ] Asignar una tarea de prueba a un operador.
- [ ] En "Lista de tareas":
   - [ ] Probar filtros: operador, estación, estado.
   - [ ] Probar rango de fecha ("Solo hoy", "Próximos 7 días", "Solo atrasadas").
   - [ ] Reasignar una tarea a otro operador.
   - [ ] Exportar CSV y revisar contenido.
- [ ] En panel admin (si tiene acceso):
   - [ ] Revisar logs y alertas de su estación.

### Auditor

- [ ] Iniciar sesión con rol "Auditor".
- [ ] En dashboard admin:
   - [ ] Revisar tarjetas de estado e incidentes.
   - [ ] Navegar a "Bitácora" y confirmar que no puede crear/editar ni exportar.
- [ ] En "Alertas":
   - [ ] Probar filtros (estación, severidad, fechas, enviados).
   - [ ] Identificar incidentes críticos.
- [ ] En "Reporte mensual":
   - [ ] Cambiar mes/estación y revisar tendencias.
   - [ ] (Opcional) Pedir al administrador la exportación de CSV si requiere evidencia.
- [ ] En "Bitácora general":
   - [ ] Buscar por usuario/actividad (ej. cambios de contraseña, resets).

### Operador (Empleado)

- [ ] Iniciar sesión con rol "Empleado".
- [ ] En "Inicio":
   - [ ] Ver tarjetas de tareas (pendientes, en progreso, atrasadas).
   - [ ] Identificar tareas del día.
- [ ] En "Mi día":
   - [ ] Revisar lista de tareas de hoy.
   - [ ] Abrir una tarea, leer el resumen y el checklist.
   - [ ] Registrar observaciones y, si aplica, evidencia.
   - [ ] Cambiar estado de la tarea (Pendiente → En progreso → Completada).
- [ ] En "Lista de tareas":
   - [ ] Confirmar que solo ve sus tareas (si aplica).
   - [ ] Usar el buscador para encontrar una tarea específica.
- [ ] En "Mi perfil":
   - [ ] Actualizar datos básicos (teléfono, correo, foto).
   - [ ] Verificar que su nombre coincide con el de las tareas asignadas.
