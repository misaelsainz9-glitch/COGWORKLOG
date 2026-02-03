# Backend COG Work Log (esqueleto)

Este directorio contiene un backend mínimo en Node.js/Express para empezar la migración a multiusuario.

## Requisitos

- Node.js 18+ instalado en tu máquina.

## Instalación

Desde esta carpeta (`backend/`):

```bash
npm install
npm start
```

Por defecto levanta en `http://localhost:3001` y expone:

- `GET /api/status` → responde con `{ ok: true, name, version }`.
- `POST /api/login` → valida `username`, `password` y opcional `role` contra `users.json`.
- `GET /api/logs` → devuelve `logs` desde `admin-data.json`.
- `GET /api/general-logs` → devuelve `generalLogs` desde `admin-data.json`.
- `GET /api/admin-state` → devuelve el estado completo de administración (`stations`, `logs`, `generalLogs`, `users`, `shifts`).
- `GET /api/operations-state` → devuelve el estado operativo (`employees`, `tasks`, `lastTaskId`, `dataVersion`) desde `operations-data.json`.
- `POST /api/admin-state` → recibe un objeto `state` y sobrescribe `admin-data.json`.
- `POST /api/operations-state` → recibe un objeto `state` y sobrescribe `operations-data.json`.

## Importar un respaldo existente

Si ya tienes un respaldo exportado desde el frontend, con estructura:

```json
{
	"admin": { ... },
	"operations": { ... }
}
```

puedes usar el script `import-backup.js` para poblar los archivos que usa el backend:

1. Copia tu archivo de respaldo dentro de la carpeta `backend/` (por ejemplo `backend/cog-backup.json`).
2. Desde `backend/` ejecuta:

```bash
node import-backup.js cog-backup.json
```

Esto generará/actualizará:

- `admin-data.json` → con `stations`, `logs`, `generalLogs`, `users`, `shifts` del bloque `admin`.
- `operations-data.json` → con `employees`, `tasks`, `lastTaskId`, `dataVersion` del bloque `operations`.
- `users.json` → usuarios simplificados para login (solo si en `admin.users` hay registros con `username`).

## Siguientes pasos recomendados

1. Alimentar `users.json`, `admin-data.json` y `operations-data.json` a partir de tus respaldos reales o de una base de datos (puedes usar `import-backup.js` como atajo inicial).
2. Añadir endpoints de escritura más específicos (por ejemplo `/api/logs` POST para crear un solo registro, `/api/tasks` para tareas) en lugar de enviar el estado completo.
3. Adaptar gradualmente el frontend para consumir estos endpoints en lugar de `localStorage`.
