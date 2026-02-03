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
      return {
        version: 7,
        stations: [],
        logs: [],
        generalLogs: [],
        users: [],
        shifts: [],
      };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? parsed
      : {
          version: 7,
          stations: [],
          logs: [],
          generalLogs: [],
          users: [],
          shifts: [],
        };
  } catch (e) {
    console.error('No se pudo cargar admin-data.json', e);
    return {
      version: 7,
      stations: [],
      logs: [],
      generalLogs: [],
      users: [],
      shifts: [],
    };
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

// Login validando contra users.json (usuario/contraseña/rol)
app.post('/api/login', (req, res) => {
  const { username, password, role } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ ok: false, message: 'Usuario y contraseña son requeridos' });
  }

  const users = loadUsers();
  let matched = users.find((u) => u.username === username);

  // Si no está en users.json, buscar también en admin-data.json (adminState.users)
  if (!matched) {
    const state = loadAdminState();
    const adminUsers = Array.isArray(state.users) ? state.users : [];
    const fromAdmin = adminUsers.find((u) => u.username === username);
    if (fromAdmin) {
      matched = fromAdmin;
    }
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
app.get('/api/logs', async (req, res) => {
  try {
    const state = await getAdminStateCombined();
    const logs = Array.isArray(state.logs) ? state.logs : [];
    res.json({ ok: true, logs });
  } catch (e) {
    console.error('Error en /api/logs', e);
    res.status(500).json({ ok: false, message: 'No se pudieron leer los logs' });
  }
});

// Lectura de bitácora general desde el estado de administración
app.get('/api/general-logs', async (req, res) => {
  try {
    const state = await getAdminStateCombined();
    const generalLogs = Array.isArray(state.generalLogs)
      ? state.generalLogs
      : [];
    res.json({ ok: true, generalLogs });
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
