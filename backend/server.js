const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

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

// Lectura de logs (por ahora demo en memoria)
// Ahora se conecta a admin-data.json para devolver registros reales
app.get('/api/logs', (req, res) => {
  const state = loadAdminState();
  const logs = Array.isArray(state.logs) ? state.logs : [];
  res.json({ ok: true, logs });
});

// Lectura de bitácora general
app.get('/api/general-logs', (req, res) => {
  const state = loadAdminState();
  const generalLogs = Array.isArray(state.generalLogs)
    ? state.generalLogs
    : [];
  res.json({ ok: true, generalLogs });
});

// Exponer el estado de administración completo (solo lectura)
app.get('/api/admin-state', (req, res) => {
  const state = loadAdminState();
  res.json({ ok: true, state });
});

// Exponer el estado operativo (solo lectura)
app.get('/api/operations-state', (req, res) => {
  const state = loadOperationsState();
  res.json({ ok: true, state });
});

// Actualizar estado de administración (sobrescribe admin-data.json)
app.post('/api/admin-state', (req, res) => {
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

    return res.json({ ok: true });
  } catch (e) {
    console.error('No se pudo guardar admin-state', e);
    return res.status(500).json({ ok: false, message: 'No se pudo guardar estado de administración' });
  }
});

// Actualizar estado operativo (sobrescribe operations-data.json)
app.post('/api/operations-state', (req, res) => {
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

    return res.json({ ok: true });
  } catch (e) {
    console.error('No se pudo guardar operations-state', e);
    return res.status(500).json({ ok: false, message: 'No se pudo guardar estado operativo' });
  }
});

app.listen(PORT, () => {
  console.log(`COG Work Log API escuchando en puerto ${PORT}`);
});
