const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Servir archivos estáticos del frontend (login.html, admin.html, index.html, etc.)
// Hacemos que la ruta raíz "/" cargue login.html por defecto.
const clientDir = path.join(__dirname, "..");
app.use(express.static(clientDir, { index: 'login.html' }));

// Usuario maestro de administración siempre disponible en el backend
const MASTER_ADMIN_USER = {
  username: 'misa',
  password: 'Pepepito2',
  name: 'Misa',
  role: 'admin',
  area: 'Corporativo',
  passwordLastChanged: '2025-01-01T00:00:00.000Z',
  locked: false,
};

function getDefaultAdminState() {
  return {
    version: 11,
    stations: [],
    logs: [],
    generalLogs: [],
    users: [
      { ...MASTER_ADMIN_USER },
    ],
    shifts: [],
  };
}

function ensureMasterAdminUser(state) {
  if (!state || typeof state !== 'object') {
    return getDefaultAdminState();
  }

  const users = Array.isArray(state.users) ? state.users.slice() : [];
  const hasMaster = users.some((u) => u && u.username === MASTER_ADMIN_USER.username);

  if (!hasMaster) {
    users.push({ ...MASTER_ADMIN_USER });
  }

  return {
    ...state,
    version: typeof state.version === 'number' ? state.version : 11,
    users,
  };
}

// Carga de usuarios desde archivo JSON sencillo
function loadUsers() {
  try {
    const filePath = path.join(__dirname, 'users.json');
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('No se pudieron cargar usuarios desde users.json', e);
    return [];
  }
}

// Carga del estado de administración (logs, estaciones, etc.) desde archivo JSON
function loadAdminState() {
  try {
    const filePath = path.join(__dirname, 'admin-data.json');
    if (!fs.existsSync(filePath)) {
      return getDefaultAdminState();
    }

    let raw = '';
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (readErr) {
      console.warn('No se pudo leer admin-data.json, usando estado por defecto');
      return getDefaultAdminState();
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      // Si el JSON está corrupto, no mostramos el stack completo, solo un aviso breve
      console.warn('admin-data.json inválido, usando estado por defecto');
      return getDefaultAdminState();
    }

    if (parsed && typeof parsed === 'object') {
      return ensureMasterAdminUser(parsed);
    }

    return getDefaultAdminState();
  } catch (e) {
    console.warn('No se pudo cargar admin-data.json, usando estado por defecto');
    return getDefaultAdminState();
  }
}

// Carga del estado operativo (empleados, tareas) desde archivo JSON
function loadOperationsState() {
  try {
    const filePath = path.join(__dirname, 'operations-data.json');
    if (!fs.existsSync(filePath)) {
      return {
        employees: [],
        tasks: [],
        lastTaskId: 0,
        dataVersion: 1,
      };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? parsed
      : {
          employees: [],
          tasks: [],
          lastTaskId: 0,
          dataVersion: 1,
        };
  } catch (e) {
    console.error('No se pudo cargar operations-data.json', e);
    return {
      employees: [],
      tasks: [],
      lastTaskId: 0,
      dataVersion: 1,
    };
  }
}

async function getAdminStateCombined() {
  try {
    const fromDb = await db.getJson('admin');
    if (fromDb && typeof fromDb === 'object') return fromDb;
  } catch (e) {
    console.error('Error leyendo admin-state desde BD, usando archivo', e);
  }
  return loadAdminState();
}

async function getOperationsStateCombined() {
  try {
    const fromDb = await db.getJson('operations');
    if (fromDb && typeof fromDb === 'object') return fromDb;
  } catch (e) {
    console.error('Error leyendo operations-state desde BD, usando archivo', e);
  }
  return loadOperationsState();
}

// Estado básico para probar que el backend responde
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    name: 'COG Work Log API',
    version: '1.0.0',
  });
});

// Notificación sencilla de alertas críticas / racha de incidentes.
// En esta versión solo se registra en consola para futuras integraciones
// con correo, WhatsApp u otros canales.
app.post('/api/notify-alert', (req, res) => {
  try {
    const payload = req.body || {};
    console.log('[ALERTA COG WORK LOG]', {
      type: payload.type,
      level: payload.level,
      message: payload.message,
      stationId: payload.stationId,
      stationName: payload.stationName,
      severity: payload.severity,
      logId: payload.logId,
      at: new Date().toISOString(),
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('Error recibiendo /api/notify-alert', e);
    return res.status(500).json({ ok: false, message: 'No se pudo registrar la alerta' });
  }
});

// Login validando primero contra admin-data (usuarios administrados) y luego contra users.json
app.post('/api/login', (req, res) => {
  const { username, password, role } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ ok: false, message: 'Usuario y contraseña son requeridos' });
  }

  // 1) Preferir siempre el catálogo de administración (admin-data.json / BD),
  //    que es el que se actualiza cuando cambias contraseñas desde el panel.
  const state = loadAdminState();
  const adminUsers = Array.isArray(state.users) ? state.users : [];
  let matched = adminUsers.find((u) => u.username === username);

  // 2) Si no existe en admin-users, usar users.json como respaldo estático
  if (!matched) {
    const users = loadUsers();
    matched = users.find((u) => u.username === username);
  }

  if (!matched) {
    return res
      .status(401)
      .json({ ok: false, message: 'Usuario no encontrado en el catálogo del servidor' });
  }

  if (matched.password !== password) {
    return res
      .status(401)
      .json({ ok: false, message: 'Contraseña incorrecta' });
  }

  if (role && matched.role && matched.role !== role) {
    return res.status(401).json({
      ok: false,
      message: 'El rol enviado no coincide con el rol configurado para este usuario',
    });
  }

  // En una versión posterior se debería emitir un JWT real
  const token = 'demo-token';

  return res.json({
    ok: true,
    token,
    user: {
      username: matched.username,
      name: matched.name || matched.username,
      role: matched.role || 'empleado',
      area: matched.area || '',
      passwordLastChanged: matched.passwordLastChanged || null,
    },
  });
});

// Lectura de logs desde el estado de administración (BD si está disponible, archivo si no)
// Soporta filtros y paginación opcional vía querystring:
//   /api/logs?stationId=...&status=ok&severity=alta&incidentType=...&fromDate=AAAA-MM-DD&toDate=AAAA-MM-DD&search=texto&page=1&pageSize=100
app.get('/api/logs', async (req, res) => {
  try {
    const state = await getAdminStateCombined();
    let logs = Array.isArray(state.logs) ? state.logs : [];

    const {
      stationId,
      status,
      severity,
      incidentType,
      fromDate,
      toDate,
      search,
      page,
      pageSize,
    } = req.query || {};

    if (stationId) {
      logs = logs.filter((l) => l.stationId === stationId);
    }
    if (status) {
      logs = logs.filter((l) => (l.status || '') === status);
    }
    if (severity) {
      const sev = String(severity).toLowerCase();
      logs = logs.filter(
        (l) => String(l.severity || '').toLowerCase() === sev
      );
    }
    if (incidentType) {
      const it = String(incidentType).toLowerCase();
      logs = logs.filter(
        (l) => String(l.incidentType || '').toLowerCase() === it
      );
    }
    if (fromDate) {
      logs = logs.filter((l) => l.date && l.date >= fromDate);
    }
    if (toDate) {
      logs = logs.filter((l) => l.date && l.date <= toDate);
    }
    if (search) {
      const q = String(search).toLowerCase();
      logs = logs.filter((l) => {
        const user = String(l.user || '').toLowerCase();
        const desc = String(l.description || '').toLowerCase();
        const entry = String(l.entry || '').toLowerCase();
        const incident = String(l.incidentType || '').toLowerCase();
        return (
          user.includes(q) ||
          desc.includes(q) ||
          entry.includes(q) ||
          incident.includes(q)
        );
      });
    }

    const total = logs.length;

    let pagedLogs = logs;
    const pageNum = page ? parseInt(page, 10) : 0;
    const sizeNum = pageSize ? parseInt(pageSize, 10) : 0;

    if (pageNum > 0 && sizeNum > 0) {
      const start = (pageNum - 1) * sizeNum;
      pagedLogs = logs.slice(start, start + sizeNum);
    }

    res.json({
      ok: true,
      logs: pagedLogs,
      total,
      page: pageNum || 1,
      pageSize: sizeNum || total,
    });
  } catch (e) {
    console.error('Error en /api/logs', e);
    res.status(500).json({ ok: false, message: 'No se pudieron leer los logs' });
  }
});

// Lectura de bitácora general desde el estado de administración
// Filtros y paginación opcional:
//   /api/general-logs?user=...&role=...&activity=...&status=ok&fromDate=AAAA-MM-DD&toDate=AAAA-MM-DD&search=texto&page=1&pageSize=100
app.get('/api/general-logs', async (req, res) => {
  try {
    const state = await getAdminStateCombined();
    let generalLogs = Array.isArray(state.generalLogs)
      ? state.generalLogs
      : [];

    const {
      user,
      role,
      activity,
      status,
      fromDate,
      toDate,
      search,
      page,
      pageSize,
    } = req.query || {};

    if (user) {
      const u = String(user).toLowerCase();
      generalLogs = generalLogs.filter(
        (g) => String(g.user || '').toLowerCase() === u
      );
    }
    if (role) {
      const r = String(role).toLowerCase();
      generalLogs = generalLogs.filter(
        (g) => String(g.role || '').toLowerCase() === r
      );
    }
    if (activity) {
      const a = String(activity).toLowerCase();
      generalLogs = generalLogs.filter(
        (g) => String(g.activity || '').toLowerCase() === a
      );
    }
    if (status) {
      generalLogs = generalLogs.filter((g) => (g.status || '') === status);
    }
    if (fromDate) {
      generalLogs = generalLogs.filter((g) => g.date && g.date >= fromDate);
    }
    if (toDate) {
      generalLogs = generalLogs.filter((g) => g.date && g.date <= toDate);
    }
    if (search) {
      const q = String(search).toLowerCase();
      generalLogs = generalLogs.filter((g) => {
        const userText = String(g.user || '').toLowerCase();
        const activityText = String(g.activity || '').toLowerCase();
        const descText = String(g.description || '').toLowerCase();
        return (
          userText.includes(q) ||
          activityText.includes(q) ||
          descText.includes(q)
        );
      });
    }

    const total = generalLogs.length;

    let pagedLogs = generalLogs;
    const pageNum = page ? parseInt(page, 10) : 0;
    const sizeNum = pageSize ? parseInt(pageSize, 10) : 0;

    if (pageNum > 0 && sizeNum > 0) {
      const start = (pageNum - 1) * sizeNum;
      pagedLogs = generalLogs.slice(start, start + sizeNum);
    }

    res.json({
      ok: true,
      generalLogs: pagedLogs,
      total,
      page: pageNum || 1,
      pageSize: sizeNum || total,
    });
  } catch (e) {
    console.error('Error en /api/general-logs', e);
    res.status(500).json({ ok: false, message: 'No se pudo leer la bitácora general' });
  }
});

// Exponer el estado de administración completo (solo lectura)
app.get('/api/admin-state', async (req, res) => {
  try {
    const state = await getAdminStateCombined();
    res.json({ ok: true, state });
  } catch (e) {
    console.error('Error en /api/admin-state', e);
    res.status(500).json({ ok: false, message: 'No se pudo leer el estado de administración' });
  }
});

// Exponer el estado operativo (solo lectura)
app.get('/api/operations-state', async (req, res) => {
  try {
    const state = await getOperationsStateCombined();
    res.json({ ok: true, state });
  } catch (e) {
    console.error('Error en /api/operations-state', e);
    res.status(500).json({ ok: false, message: 'No se pudo leer el estado operativo' });
  }
});

// Actualizar estado de administración (sobrescribe admin-data.json)
app.post('/api/admin-state', async (req, res) => {
  try {
    const body = req.body || {};
    const state = body && body.state && typeof body.state === 'object'
      ? body.state
      : body;

    const normalized = {
      version: typeof state.version === 'number' ? state.version : 7,
      stations: Array.isArray(state.stations) ? state.stations : [],
      logs: Array.isArray(state.logs) ? state.logs : [],
      generalLogs: Array.isArray(state.generalLogs) ? state.generalLogs : [],
      users: Array.isArray(state.users) ? state.users : [],
      shifts: Array.isArray(state.shifts) ? state.shifts : [],
    };

    const filePath = path.join(__dirname, 'admin-data.json');
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8');

    try {
      await db.saveJson('admin', normalized);
    } catch (e) {
      console.error('No se pudo guardar admin-state en BD, pero sí en archivo', e);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('No se pudo guardar admin-state', e);
    return res.status(500).json({ ok: false, message: 'No se pudo guardar estado de administración' });
  }
});

// Actualizar estado operativo (sobrescribe operations-data.json)
app.post('/api/operations-state', async (req, res) => {
  try {
    const body = req.body || {};
    const state = body && body.state && typeof body.state === 'object'
      ? body.state
      : body;

    const normalized = {
      employees: Array.isArray(state.employees) ? state.employees : [],
      tasks: Array.isArray(state.tasks) ? state.tasks : [],
      lastTaskId: typeof state.lastTaskId === 'number' ? state.lastTaskId : 0,
      dataVersion: typeof state.dataVersion === 'number' ? state.dataVersion : 1,
    };

    const filePath = path.join(__dirname, 'operations-data.json');
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8');

    try {
      await db.saveJson('operations', normalized);
    } catch (e) {
      console.error('No se pudo guardar operations-state en BD, pero sí en archivo', e);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('No se pudo guardar operations-state', e);
    return res.status(500).json({ ok: false, message: 'No se pudo guardar estado operativo' });
  }
});

db
  .init()
  .catch((e) => {
    console.error('No se pudo inicializar la base de datos, se usarán solo archivos JSON', e);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`COG Work Log API escuchando en puerto ${PORT}`);
    });
  });
