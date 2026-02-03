const ADMIN_STORAGE_KEY = "cog-work-log-admin";
const THEME_STORAGE_KEY = "cog-work-log-theme";
// Configuración opcional de backend para administración
// Usamos misma origen (Render o servidor local que sirve los estáticos y la API)
const BACKEND_URL = "";
const BACKEND_ADMIN_ENABLED = true;
// Versión de esquema de datos de administración para poder regenerar seeds cuando cambian
const ADMIN_DATA_VERSION = 7;
const LOG_FILTERS_KEY = "cog-work-log-admin-log-filters";
const REPORT_FILTERS_KEY = "cog-work-log-admin-report-filters";
const LOG_SAVED_VIEWS_KEY = "cog-work-log-admin-log-saved-views";
const OPERATIONS_STORAGE_KEY = "cog-work-log-data";

let adminState = {
  version: ADMIN_DATA_VERSION,
  stations: [],
  logs: [],
  generalLogs: [],
  users: [],
  shifts: [],
};

let currentUser = null;
let assignedStationId = "";
let dashboardStationId = "";
let adminCalendar = null;
let currentCommentsLogId = null;
let statusChart = null;
let frequencyChart = null;
let fuelTypeTodayChart = null;
let fuelTypeMonthChart = null;
let quickFilterOverdue = false;
let quickFilterIncidents = false;
let quickFilterLast7 = false;
let quickFilterNoFollowUp = false;
let quickFilterFuelDeliveries = false;
let quickFilterEvidence = false;
let quickFilterSentToAdmin = false;
let quickFilterHighSeverity = false;
let quickFilterEvidencePending = false;

// Plugins de Chart.js para mejorar calidad visual de las gráficas del panel
var dashboardDoughnutCenter = {
  id: "dashboardDoughnutCenter",
  afterDraw: function (chart, args, options) {
    if (!chart || !chart.ctx) return;
    var ctx = chart.ctx;
    var width = chart.width;
    var height = chart.height;

    var ds = chart.data && chart.data.datasets && chart.data.datasets[0];
    if (!ds || !ds.data) return;

    var dataArr = ds.data;
    var total = 0;
    for (var i = 0; i < dataArr.length; i++) {
      var v = dataArr[i];
      total += typeof v === "number" ? v : 0;
    }

    var label = options && options.label ? options.label : "Total";
    var color = options && options.color ? options.color : "#0f172a";
    var fontSize = options && options.fontSize ? options.fontSize : 14;

    ctx.save();
    ctx.font =
      "600 " +
      fontSize +
      "px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(total, width / 2, height / 2 - 4);

    ctx.font =
      "500 " +
      (fontSize - 2) +
      "px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.globalAlpha = 0.8;
    ctx.fillText(label, width / 2, height / 2 + 14);
    ctx.restore();
  },
};

var dashboardBarLabels = {
  id: "dashboardBarLabels",
  afterDatasetsDraw: function (chart, args, options) {
    if (!chart || !chart.ctx) return;
    var ctx = chart.ctx;
    var ds = chart.data && chart.data.datasets && chart.data.datasets[0];
    if (!ds || !ds.data) return;
    var meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data) return;

    var color = options && options.color ? options.color : "#0f172a";
    var fontSize = options && options.fontSize ? options.fontSize : 10;
    var offsetY =
      options && typeof options.offsetY === "number" ? options.offsetY : -4;

    ctx.save();
    ctx.font =
      "500 " +
      fontSize +
      "px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    for (var i = 0; i < meta.data.length; i++) {
      var element = meta.data[i];
      if (!element) continue;
      var value = ds.data[i];
      if (!value) continue;

      var pos = element.tooltipPosition();
      ctx.fillText(value, pos.x, pos.y + offsetY);
    }

    ctx.restore();
  },
};

  function getFuelColorForType(type) {
    const lower = (type || "").toString().toLowerCase();
    if (lower.indexOf("magna") !== -1 || lower.indexOf("verde") !== -1) {
      return "#16a34a"; // verde
    }
    if (lower.indexOf("premium") !== -1 || lower.indexOf("roja") !== -1) {
      return "#dc2626"; // rojo
    }
    if (lower.indexOf("diésel") !== -1 || lower.indexOf("diesel") !== -1) {
      return "#111827"; // negro
    }
    return "#6b7280"; // gris para otros
  }

let lastApprovedLogId = null;
let lastCommentedLogId = null;

let logPage = 1;
const LOG_PAGE_SIZE = 15;

let usersPage = 1;
const USERS_PAGE_SIZE = 10;

const ROLE_PERMISSIONS = {
  admin: {
    createLog: true,
    manageStations: true,
    manageUsers: true,
    manageShifts: true,
    exportLogs: true,
    printLogs: true,
    commentLogs: true,
  },
  auditor: {
    createLog: false,
    manageStations: false,
    manageUsers: false,
    manageShifts: false,
    exportLogs: false,
    printLogs: false,
    commentLogs: false,
  },
  supervisor: {
    createLog: true,
    manageStations: true,
    manageUsers: false,
    manageShifts: true,
    exportLogs: true,
    printLogs: true,
    commentLogs: true,
  },
  jefe_estacion: {
    createLog: true,
    manageStations: false,
    manageUsers: false,
    manageShifts: true,
    exportLogs: true,
    printLogs: true,
    commentLogs: true,
  },
  empleado: {
    createLog: false,
    manageStations: false,
    manageUsers: false,
    manageShifts: false,
    exportLogs: false,
    printLogs: false,
    commentLogs: false,
  },
};

const ADMIN_IDLE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutos
let adminIdleTimeoutHandle = null;

function can(permission) {
  if (!currentUser) return false;
  const defs = ROLE_PERMISSIONS[currentUser.role] || {};
  return !!defs[permission];
}

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  if (type === "error") toast.classList.add("toast-error");
  else if (type === "warning") toast.classList.add("toast-warning");
  else toast.classList.add("toast-success");

  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(4px)";
  }, 2200);

  setTimeout(() => {
    toast.remove();
  }, 2700);
}

function resetAdminIdleTimer() {
  if (adminIdleTimeoutHandle) {
    clearTimeout(adminIdleTimeoutHandle);
  }
  adminIdleTimeoutHandle = setTimeout(() => {
    try {
      const user = currentUser || getCurrentUser();
      addGeneralLogEntry(
        "Cierre de sesión por inactividad",
        "Sesión cerrada automáticamente en panel administración tras inactividad.",
        "ok"
      );
    } catch (e) {
      console.error("No se pudo registrar cierre por inactividad (admin)", e);
    }

    if (typeof clearAuth === "function") {
      clearAuth();
    }
    window.location.href = "login.html";
  }, ADMIN_IDLE_TIMEOUT_MS);
}

function addGeneralLogEntry(activity, description, status = "ok") {
  try {
    const generalLogs = Array.isArray(adminState.generalLogs)
      ? adminState.generalLogs
      : [];

    const nextId =
      generalLogs.reduce((max, l) => Math.max(max, l.id || 0), 0) + 1;
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 5);

    const name = currentUser && currentUser.name ? currentUser.name : "Sistema";
    const role = currentUser && currentUser.role ? currentUser.role : "sistema";
    const username =
      currentUser && currentUser.username ? currentUser.username : "";

    generalLogs.push({
      id: nextId,
      user: name,
      role,
      activity,
      description,
      date,
      time,
      status,
      username,
    });

    adminState.generalLogs = generalLogs;
    saveAdminState();
  } catch (err) {
    console.error("No se pudo registrar en bitácora general", err);
  }
}

// Sincronizar adminState con el backend si está disponible
async function syncAdminStateFromBackendIfAvailable() {
  if (!BACKEND_ADMIN_ENABLED || typeof fetch === "undefined") {
    return;
  }

  try {
    const resp = await fetch(BACKEND_URL + "/api/admin-state");
    let data = null;
    try {
      data = await resp.json();
    } catch (e) {
      data = null;
    }

    if (!resp.ok || !data || data.ok === false || !data.state) {
      return;
    }

    const backendState = data.state || {};
    adminState = {
      version:
        typeof backendState.version === "number"
          ? backendState.version
          : ADMIN_DATA_VERSION,
      stations: Array.isArray(backendState.stations)
        ? backendState.stations
        : [],
      logs: Array.isArray(backendState.logs) ? backendState.logs : [],
      generalLogs: Array.isArray(backendState.generalLogs)
        ? backendState.generalLogs
        : [],
      users: Array.isArray(backendState.users) ? backendState.users : [],
      shifts: Array.isArray(backendState.shifts) ? backendState.shifts : [],
    };

    // Persistir también en localStorage para que el resto del flujo siga igual
    saveAdminState();
  } catch (e) {
    console.warn("No se pudo sincronizar admin-state desde backend", e);
  }
}

// Enviar estado de administración al backend si está disponible (best-effort)
async function syncAdminStateToBackendIfAvailable() {
  if (!BACKEND_ADMIN_ENABLED || typeof fetch === "undefined") {
    return;
  }

  try {
    await fetch(BACKEND_URL + "/api/admin-state", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state: adminState }),
    });
  } catch (e) {
    console.warn("No se pudo enviar admin-state al backend", e);
  }
}

function loadAdminState() {
  const raw = window.localStorage.getItem(ADMIN_STORAGE_KEY);
  if (!raw) {
    seedAdminState();
    saveAdminState();
    return;
  }
  try {
    const parsed = JSON.parse(raw);

    const storedVersion = parsed && typeof parsed.version === "number" ? parsed.version : 1;

    // Si la versión guardada es antigua, regenerar completamente los datos demo de administración
    if (!parsed || storedVersion < ADMIN_DATA_VERSION) {
      seedAdminState();
      saveAdminState();
    } else {
      adminState = { ...adminState, ...parsed };
    }
  } catch (e) {
    console.error("No se pudo leer datos de administración, se cargan valores por defecto", e);
    seedAdminState();
    saveAdminState();
  }
}

function saveAdminState() {
  window.localStorage.setItem(
    ADMIN_STORAGE_KEY,
    JSON.stringify({
      version: adminState.version || ADMIN_DATA_VERSION,
      stations: adminState.stations,
      logs: adminState.logs,
      generalLogs: adminState.generalLogs,
      users: adminState.users,
      shifts: adminState.shifts,
    })
  );

  // Best-effort: reflejar cambios también en backend si está disponible
  syncAdminStateToBackendIfAvailable();
}

function seedAdminState() {
  adminState.version = ADMIN_DATA_VERSION;
  adminState.stations = [
    {
      id: "st1",
      name: "Gasolinera Las Torres",
      location: "Monterrey, N.L.",
      description: "Gasolinera urbana · Operación 24h · Zona norte",
      employees: [
        { name: "Encargado Las Torres", role: "Encargado · Jefe de estación" },
        { name: "Operador Torres 1", role: "Operador · Área Operación" },
        { name: "Operador Torres 2", role: "Operador · Área Operación" },
        { name: "Operador Torres 3", role: "Operador · Área Operación" },
      ],
    },
    {
      id: "st2",
      name: "Gasolinera Cumbres",
      location: "Monterrey, N.L.",
      description: "Gasolinera urbana · Zona poniente",
      employees: [
        { name: "Encargado Cumbres", role: "Encargado · Jefe de estación" },
        { name: "Operador Cumbres 1", role: "Operador · Área Operación" },
        { name: "Operador Cumbres 2", role: "Operador · Área Operación" },
        { name: "Operador Cumbres 3", role: "Operador · Área Operación" },
      ],
    },
    {
      id: "st3",
      name: "Gasolinera Centro",
      location: "Monterrey, N.L.",
      description: "Gasolinera urbana · Zona centro",
      employees: [
        { name: "Encargado Centro", role: "Encargado · Jefe de estación" },
        { name: "Operador Centro 1", role: "Operador · Área Operación" },
        { name: "Operador Centro 2", role: "Operador · Área Operación" },
        { name: "Operador Centro 3", role: "Operador · Área Operación" },
      ],
    },
    {
      id: "st4",
      name: "Gasolinera Aeropuerto",
      location: "Apodaca, N.L.",
      description: "Gasolinera de alto flujo · Zona aeropuerto",
      employees: [
        { name: "Encargado Aeropuerto", role: "Encargado · Jefe de estación" },
        { name: "Operador Aeropuerto 1", role: "Operador · Área Operación" },
        { name: "Operador Aeropuerto 2", role: "Operador · Área Operación" },
        { name: "Operador Aeropuerto 3", role: "Operador · Área Operación" },
      ],
    },
    {
      id: "st5",
      name: "Gasolinera Valle Oriente",
      location: "San Pedro, N.L.",
      description: "Gasolinera corporativa · Zona financiera",
      employees: [
        { name: "Encargado Valle", role: "Encargado · Jefe de estación" },
        { name: "Operador Valle 1", role: "Operador · Área Operación" },
        { name: "Operador Valle 2", role: "Operador · Área Operación" },
        { name: "Operador Valle 3", role: "Operador · Área Operación" },
      ],
    },
  ];

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const isoOffset = (days) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  adminState.logs = [
    {
      id: 1,
      stationId: "st1",
      user: "Luis Ramirez",
      entry: "Entrada turno matutino",
      description: "Revisión general sin novedades.",
      date: todayIso,
      time: "07:00",
      status: "ok",
      frequency: "diaria",
      shift: "matutino",
      incidentType: "Ronda de arranque",
      severity: "baja",
    },
    {
      id: 2,
      stationId: "st1",
      user: "Ana López",
      entry: "Check list de apertura",
      description: "Extintores y kits de derrame verificados.",
      date: todayIso,
      time: "06:40",
      status: "ok",
      frequency: "diaria",
      shift: "matutino",
      incidentType: "Checklist apertura",
      severity: "baja",
    },
    {
      id: 3,
      stationId: "st2",
      user: "José Herrera",
      entry: "Ronda de seguridad",
      description: "Se detecta luminaria apagada en zona de descarga.",
      date: isoOffset(-1),
      time: "21:30",
      status: "error",
      frequency: "diaria",
      shift: "nocturno",
      incidentType: "Falla de luminaria",
      severity: "alta",
      approvalStatus: "pendiente",
      comments: [
        "Incidente detectado en ronda nocturna.",
        "Pendiente cambio de luminaria.",
      ],
    },
    {
      id: 4,
      stationId: "st2",
      user: "Carlos Pérez",
      entry: "Seguimiento incidente",
      description: "Se programa cambio de luminaria defectuosa.",
      date: todayIso,
      time: "10:15",
      status: "warning",
      frequency: "unica",
      shift: "matutino",
      incidentType: "Seguimiento incidente",
      severity: "media",
      comments: ["Orden de trabajo enviada a mantenimiento."],
    },
    {
      id: 5,
      stationId: "st1",
      user: "Patricia Mendoza",
      entry: "Cierre turno matutino",
      description:
        "Turno sin incidentes. Se deja pendiente verificación de inventario tienda.",
      date: todayIso,
      time: "15:05",
      status: "ok",
      frequency: "diaria",
      shift: "matutino",
      incidentType: "Cierre de turno",
      severity: "baja",
      comments: [
        "Inventario de tienda programado para turno vespertino.",
      ],
    },
    {
      id: 6,
      stationId: "st1",
      user: "María González",
      entry: "Incidente menor en isla 2",
      description:
        "Se detecta pequeño derrame de combustible, se atiende con kit de derrames.",
      date: isoOffset(-1),
      time: "12:20",
      status: "warning",
      frequency: "unica",
      shift: "vespertino",
      incidentType: "Derrame menor",
      severity: "media",
      comments: [
        "No hubo contacto con cliente.",
        "Área acordonada y limpiada de inmediato.",
      ],
    },
    {
      id: 7,
      stationId: "st2",
      user: "Miguel Torres",
      entry: "Revisión semanal de extintores",
      description:
        "Extintores dentro de rango, se detecta uno cercano a fecha de recarga.",
      date: isoOffset(-2),
      time: "09:10",
      status: "warning",
      frequency: "semanal",
      shift: "matutino",
      incidentType: "Revisión de extintores",
      severity: "media",
      comments: ["Programar recarga antes de fin de mes."],
    },
    {
      id: 8,
      stationId: "st1",
      user: "Laura Sánchez",
      entry: "Auditoría interna de checklist",
      description:
        "Checklist críticos completos en 95%. Se detectan 2 pendientes sin impacto.",
      date: isoOffset(-3),
      time: "16:45",
      status: "ok",
      frequency: "mensual",
      shift: "vespertino",
      incidentType: "Auditoría interna",
      severity: "baja",
    },
    {
      id: 9,
      stationId: "st2",
      user: "Carlos Pérez",
      entry: "Incidente crítico en descarga",
      description:
        "Se detecta fuga moderada en manguera de descarga, se activa protocolo.",
      date: todayIso,
      time: "05:30",
      status: "error",
      frequency: "unica",
      shift: "nocturno",
      incidentType: "Fuga en descarga",
      severity: "alta",
      approvalStatus: "pendiente",
      comments: [
        "Se detiene descarga y se aísla zona.",
        "Se notifica a proveedor y se documenta evidencia.",
      ],
    },
    {
      id: 10,
      stationId: "st1",
      user: "Jefe Estación Las Torres",
      entry: "Revisión de incidentes del día",
      description:
        "Se revisan incidentes y se asignan responsables de seguimiento.",
      date: todayIso,
      time: "18:10",
      status: "ok",
      frequency: "diaria",
      shift: "vespertino",
      incidentType: "Revisión diaria de incidentes",
      severity: "baja",
    },
    {
      id: 11,
      stationId: "st2",
      user: "Auditor Seguridad",
      entry: "Visita de auditoría sorpresa",
      description:
        "Se realiza auditoría express, se levantan 3 recomendaciones menores.",
      date: isoOffset(-1),
      time: "11:40",
      status: "warning",
      frequency: "unica",
      shift: "matutino",
      incidentType: "Auditoría externa",
      severity: "media",
      comments: [
        "Actualizar señalización en área de descarga.",
        "Mejorar iluminación de pasillo lateral.",
      ],
    },
    {
      id: 12,
      stationId: "st1",
      user: "Luis Ramirez",
      entry: "Cierre turno nocturno",
      description:
        "Se deja estación en orden. Se reporta pendiente de limpieza ligera.",
      date: isoOffset(-1),
      time: "23:55",
      status: "ok",
      frequency: "diaria",
      shift: "nocturno",
      incidentType: "Cierre de turno",
      severity: "baja",
    },
    {
      id: 13,
      stationId: "st1",
      user: "Jefe Estación Las Torres",
      entry: "Asignación de checklist de apertura",
      description:
        "Se asigna checklist de apertura a Luis Ramirez y Ana López para el turno matutino.",
      date: todayIso,
      time: "05:50",
      status: "ok",
      frequency: "diaria",
      shift: "matutino",
      incidentType: "Asignación de actividades",
      severity: "baja",
      comments: [
        "Responsables: Luis Ramirez (bomba), Ana López (isla).",
      ],
    },
    {
      id: 14,
      stationId: "st1",
      user: "Jefe Área Operación",
      entry: "Asignación de simulacro interno",
      description:
        "Se programa simulacro corto de fuga controlada y se asigna a Miguel Torres como líder.",
      date: isoOffset(2),
      time: "10:00",
      status: "ok",
      frequency: "mensual",
      shift: "matutino",
      incidentType: "Plan de simulacros",
      severity: "media",
      comments: [
        "Participan: personal de operación y seguridad de ambas estaciones.",
      ],
    },
    {
      id: 15,
      stationId: "st2",
      user: "Jefe Área Seguridad",
      entry: "Seguimiento a incidentes de derrame",
      description:
        "Se revisan incidentes de derrame y se asigna capacitación express a personal de islas.",
      date: todayIso,
      time: "14:30",
      status: "warning",
      frequency: "mensual",
      shift: "vespertino",
      incidentType: "Seguimiento de incidentes",
      severity: "media",
      comments: [
        "Capacitación asignada a: María González y Operadores Cumbres.",
      ],
    },
    {
      id: 16,
      stationId: "st2",
      user: "Operador Cumbres 1",
      entry: "Ejecución de checklist de descarga",
      description:
        "Se completa checklist de descarga de autotanque asignado por Jefe Área Seguridad.",
      date: todayIso,
      time: "09:20",
      status: "ok",
      frequency: "unica",
      shift: "matutino",
      incidentType: "Checklist de descarga",
      severity: "baja",
      comments: [
        "Responsable de supervisión: Miguel Torres (Supervisor de seguridad).",
      ],
    },
    {
      id: 17,
      stationId: "st1",
      user: "Coordinador Calidad",
      entry: "Plan de acción de calidad",
      description:
        "Se asignan acciones de mejora a auxiliares administrativos y personal de pista.",
      date: isoOffset(-2),
      time: "13:15",
      status: "ok",
      frequency: "mensual",
      shift: "vespertino",
      incidentType: "Plan de calidad",
      severity: "baja",
      comments: [
        "Acciones asignadas a Verónica Ortiz y Luis Ramirez.",
      ],
    },
    {
      id: 18,
      stationId: "st2",
      user: "Jefe Estación Las Torres",
      entry: "Intercambio de mejores prácticas",
      description:
        "Jefe de Estación Las Torres comparte mejores prácticas y asigna revisión cruzada a Jefe Área Seguridad.",
      date: isoOffset(-1),
      time: "17:50",
      status: "ok",
      frequency: "unica",
      shift: "vespertino",
      incidentType: "Mejores prácticas",
      severity: "baja",
      comments: [
        "Se asigna revisión de procedimientos a Jefe Área Seguridad.",
      ],
    },
    {
      id: 19,
      stationId: "st1",
      user: "Jefe Área Operación",
      entry: "Revisión de cumplimiento de tareas",
      description:
        "Se valida avance de tareas recurrentes y se reasignan pendientes a Patricia Mendoza.",
      date: todayIso,
      time: "19:00",
      status: "warning",
      frequency: "semanal",
      shift: "vespertino",
      incidentType: "Cumplimiento de tareas",
      severity: "media",
      comments: [
        "Pendientes reasignados a supervisora de turno para cierre.",
      ],
    },
    {
      id: 20,
      stationId: "st2",
      user: "Jefe Área Seguridad",
      entry: "Asignación de ronda nocturna",
      description:
        "Se asigna ronda perimetral nocturna a Carlos Pérez y Operador Cumbres 2.",
      date: isoOffset(1),
      time: "20:30",
      status: "ok",
      frequency: "diaria",
      shift: "nocturno",
      incidentType: "Ronda de seguridad",
      severity: "baja",
      comments: [
        "Objetivo: validar corrección de fallas de luminaria y accesos.",
      ],
    },
    {
      id: 21,
      stationId: "st1",
      user: "Operador Torres 1",
      entry: "Recepción de pipa/autotanque",
      description:
        "Recepción de pipa de Magna por 20,000 litros. Horario de descarga: 07:30 a 08:10.",
      date: isoOffset(-3),
      time: "07:30",
      status: "ok",
      frequency: "unica",
      shift: "matutino",
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: "https://ejemplo.com/carta-porte-001.pdf",
      evidenceUrl: "https://ejemplo.com/ticket-pipa-001.jpg",
      fuelType: "Magna",
      fuelLiters: 20000,
    },
    {
      id: 22,
      stationId: "st2",
      user: "Operador Cumbres 1",
      entry: "Recepción de pipa/autotanque",
      description:
        "Recepción de pipa de Diésel por 15,500 litros. Horario de descarga: 09:15 a 09:55.",
      date: isoOffset(-1),
      time: "09:15",
      status: "ok",
      frequency: "unica",
      shift: "matutino",
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: "https://ejemplo.com/carta-porte-002.pdf",
      evidenceUrl: "https://ejemplo.com/ticket-pipa-002.jpg",
      fuelType: "Diésel",
      fuelLiters: 15500,
    },
    {
      id: 23,
      stationId: "st3",
      user: "Operador Centro 2",
      entry: "Recepción de pipa/autotanque",
      description:
        "Recepción de pipa de Premium por 12,000 litros. Horario de descarga: 18:05 a 18:40.",
      date: todayIso,
      time: "18:05",
      status: "ok",
      frequency: "unica",
      shift: "vespertino",
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: "https://ejemplo.com/carta-porte-003.pdf",
      evidenceUrl: "https://ejemplo.com/ticket-pipa-003.jpg",
      fuelType: "Premium",
      fuelLiters: 12000,
    },
    {
      id: 24,
      stationId: "st1",
      user: "Operador Torres 2",
      entry: "Recepción de pipa/autotanque",
      description:
        "Recepción de pipa de Diésel por 18,000 litros. Horario de descarga: 22:10 a 22:45.",
      date: isoOffset(-5),
      time: "22:10",
      status: "ok",
      frequency: "unica",
      shift: "nocturno",
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: "https://ejemplo.com/carta-porte-004.pdf",
      evidenceUrl: "https://ejemplo.com/ticket-pipa-004.jpg",
      fuelType: "Diésel",
      fuelLiters: 18000,
    },
    {
      id: 25,
      stationId: "st2",
      user: "Operador Cumbres 2",
      entry: "Recepción de pipa/autotanque",
      description:
        "Recepción de pipa de Magna por 19,000 litros. Horario de descarga: 06:50 a 07:25.",
      date: isoOffset(2),
      time: "06:50",
      status: "ok",
      frequency: "unica",
      shift: "matutino",
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: "https://ejemplo.com/carta-porte-005.pdf",
      evidenceUrl: "https://ejemplo.com/ticket-pipa-005.jpg",
      fuelType: "Magna",
      fuelLiters: 19000,
    },
    {
      id: 26,
      stationId: "st4",
      user: "Operador Aeropuerto 1",
      entry: "Recepción de pipa/autotanque",
      description:
        "Recepción de pipa de Magna por 22,000 litros. Horario de descarga: 05:40 a 06:20.",
      date: isoOffset(-2),
      time: "05:40",
      status: "ok",
      frequency: "unica",
      shift: "matutino",
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: "https://ejemplo.com/carta-porte-006.pdf",
      evidenceUrl: "https://ejemplo.com/ticket-pipa-006.jpg",
      fuelType: "Magna",
      fuelLiters: 22000,
    },
    {
      id: 27,
      stationId: "st4",
      user: "Operador Aeropuerto 2",
      entry: "Recepción de pipa/autotanque",
      description:
        "Recepción de pipa de Diésel por 24,000 litros. Horario de descarga: 13:10 a 13:55.",
      date: todayIso,
      time: "13:10",
      status: "ok",
      frequency: "unica",
      shift: "vespertino",
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: "https://ejemplo.com/carta-porte-007.pdf",
      evidenceUrl: "https://ejemplo.com/ticket-pipa-007.jpg",
      fuelType: "Diésel",
      fuelLiters: 24000,
    },
    {
      id: 28,
      stationId: "st5",
      user: "Operador Valle 1",
      entry: "Recepción de pipa/autotanque",
      description:
        "Recepción de pipa de Premium por 14,500 litros. Horario de descarga: 10:20 a 10:55.",
      date: isoOffset(-4),
      time: "10:20",
      status: "ok",
      frequency: "unica",
      shift: "matutino",
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: "https://ejemplo.com/carta-porte-008.pdf",
      evidenceUrl: "https://ejemplo.com/ticket-pipa-008.jpg",
      fuelType: "Premium",
      fuelLiters: 14500,
    },
    {
      id: 29,
      stationId: "st5",
      user: "Operador Valle 2",
      entry: "Recepción de pipa/autotanque",
      description:
        "Recepción de pipa de Diésel por 20,000 litros. Horario de descarga: 21:00 a 21:35.",
      date: isoOffset(-1),
      time: "21:00",
      status: "ok",
      frequency: "unica",
      shift: "nocturno",
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: "https://ejemplo.com/carta-porte-009.pdf",
      evidenceUrl: "https://ejemplo.com/ticket-pipa-009.jpg",
      fuelType: "Diésel",
      fuelLiters: 20000,
    },
    // Pipa nocturna semanal por estación (histórico adicional)
    {
      id: 30,
      stationId: "st1",
      user: "Operador Torres 3",
      entry: "Recepción de pipa/autotanque",
      description:
        "Recepción de pipa nocturna de Magna por 21,000 litros. Descarga de 23:10 a 23:45.",
      date: isoOffset(-7),
      time: "23:10",
      status: "ok",
      frequency: "unica",
      shift: "nocturno",
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: "https://ejemplo.com/carta-porte-010.pdf",
      evidenceUrl: "https://ejemplo.com/ticket-pipa-010.jpg",
      fuelType: "Magna",
      fuelLiters: 21000,
    },
    {
      id: 31,
      stationId: "st2",
      user: "Operador Cumbres 3",
      entry: "Recepción de pipa/autotanque",
      description:
        "Recepción de pipa nocturna de Diésel por 23,500 litros. Descarga de 00:20 a 01:00.",
      date: isoOffset(-8),
      time: "00:20",
      status: "ok",
      frequency: "unica",
      shift: "nocturno",
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: "https://ejemplo.com/carta-porte-011.pdf",
      evidenceUrl: "https://ejemplo.com/ticket-pipa-011.jpg",
      fuelType: "Diésel",
      fuelLiters: 23500,
    },
    {
      id: 32,
      stationId: "st3",
      user: "Operador Centro 1",
      entry: "Recepción de pipa/autotanque",
      description:
        "Recepción de pipa nocturna de Premium por 16,000 litros. Descarga de 22:30 a 23:05.",
      date: isoOffset(-6),
      time: "22:30",
      status: "ok",
      frequency: "unica",
      shift: "nocturno",
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: "https://ejemplo.com/carta-porte-012.pdf",
      evidenceUrl: "https://ejemplo.com/ticket-pipa-012.jpg",
      fuelType: "Premium",
      fuelLiters: 16000,
    },
    {
      id: 33,
      stationId: "st4",
      user: "Operador Aeropuerto 3",
      entry: "Recepción de pipa/autotanque",
      description:
        "Recepción de pipa nocturna de Magna por 25,000 litros. Descarga de 02:15 a 02:55.",
      date: isoOffset(-9),
      time: "02:15",
      status: "ok",
      frequency: "unica",
      shift: "nocturno",
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: "https://ejemplo.com/carta-porte-013.pdf",
      evidenceUrl: "https://ejemplo.com/ticket-pipa-013.jpg",
      fuelType: "Magna",
      fuelLiters: 25000,
    },
    {
      id: 34,
      stationId: "st5",
      user: "Operador Valle 3",
      entry: "Recepción de pipa/autotanque",
      description:
        "Recepción de pipa nocturna de Diésel por 22,000 litros. Descarga de 23:40 a 00:15.",
      date: isoOffset(-10),
      time: "23:40",
      status: "ok",
      frequency: "unica",
      shift: "nocturno",
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: "https://ejemplo.com/carta-porte-014.pdf",
      evidenceUrl: "https://ejemplo.com/ticket-pipa-014.jpg",
      fuelType: "Diésel",
      fuelLiters: 22000,
    },
  ];

  // Historial adicional generado: 2 recepciones de pipa por semana y por estación
  // durante varias semanas hacia atrás para enriquecer los análisis.
  try {
    var lastSeedId = adminState.logs.reduce(function (max, l) {
      if (!l || typeof l.id !== "number") return max;
      return l.id > max ? l.id : max;
    }, 0);

    var generatedId = lastSeedId + 1;
    var pipaStations = [
      { id: "st1", user: "Operador Torres 1", fuelType: "Magna" },
      { id: "st2", user: "Operador Cumbres 1", fuelType: "Diésel" },
      { id: "st3", user: "Operador Centro 1", fuelType: "Premium" },
      { id: "st4", user: "Operador Aeropuerto 1", fuelType: "Magna" },
      { id: "st5", user: "Operador Valle 1", fuelType: "Diésel" },
    ];

    var weeksBack = 6; // ~ mes y medio de historial adicional
    for (var w = 2; w <= weeksBack + 1; w++) {
      var baseDays = -7 * w;

      for (var s = 0; s < pipaStations.length; s++) {
        var st = pipaStations[s];

        // Pipa 1 de la semana (turno matutino)
        adminState.logs.push({
          id: generatedId++,
          stationId: st.id,
          user: st.user,
          entry: "Recepción de pipa/autotanque",
          description:
            "Recepción programada de pipa de " +
            st.fuelType +
            " para reposición semanal.",
          date: isoOffset(baseDays),
          time: "07:15",
          status: "ok",
          frequency: "unica",
          shift: "matutino",
          incidentType: "Recepción de pipa",
          severity: "baja",
          fuelType: st.fuelType,
          fuelLiters: 18000 + w * 500,
        });

        // Pipa 2 de la semana (turno vespertino)
        adminState.logs.push({
          id: generatedId++,
          stationId: st.id,
          user: st.user,
          entry: "Recepción de pipa/autotanque",
          description:
            "Segunda recepción semanal de pipa de " +
            st.fuelType +
            " para asegurar inventario.",
          date: isoOffset(baseDays + 3),
          time: "17:30",
          status: "ok",
          frequency: "unica",
          shift: "vespertino",
          incidentType: "Recepción de pipa",
          severity: "baja",
          fuelType: st.fuelType,
          fuelLiters: 19000 + w * 400,
        });
      }
    }
  } catch (e) {
    console.error("No se pudo generar historial adicional de pipas demo", e);
  }

  adminState.generalLogs = [
    {
      id: 1,
      user: "Administrador1",
      role: "admin",
      activity: "Alta de estación",
      description: "Se creó Estación Cumbres.",
      date: isoOffset(-7),
      time: "10:15",
      status: "ok",
    },
    {
      id: 2,
      user: "Jefe Estación Operación",
      role: "jefe_estacion",
      activity: "Asignación de tareas",
      description: "Se asignan actividades diarias a Operación Las Torres.",
      date: isoOffset(-1),
      time: "16:40",
      status: "ok",
    },
    {
      id: 3,
      user: "Jefe Estación Seguridad",
      role: "jefe_estacion",
      activity: "Registro de incidente",
      description: "Se registra incidente menor en zona de descarga.",
      date: isoOffset(-1),
      time: "21:35",
      status: "warning",
    },
    {
      id: 4,
      user: "Administrador1",
      role: "admin",
      activity: "Inicio de sesión",
      description: "Administrador1 inicia sesión en módulo de administración.",
      date: todayIso,
      time: "08:00",
      status: "ok",
    },
    {
      id: 5,
      user: "Jefe Estación Las Torres",
      role: "jefe_estacion",
      activity: "Inicio de sesión",
      description: "Jefe de estación accede para revisar bitácora.",
      date: todayIso,
      time: "08:15",
      status: "ok",
    },
    {
      id: 6,
      user: "Jefe Estación Seguridad",
      role: "jefe_estacion",
      activity: "Revisión de incidentes críticos",
      description:
        "Se revisan incidentes críticos pendientes y se solicita evidencia adicional.",
      date: todayIso,
      time: "09:30",
      status: "warning",
    },
    {
      id: 7,
      user: "Auditor Seguridad",
      role: "auditor",
      activity: "Visita de seguimiento",
      description:
        "Auditor visita Estación Cumbres para validar planes de acción.",
      date: isoOffset(-1),
      time: "12:10",
      status: "ok",
    },
    {
      id: 8,
      user: "Administrador1",
      role: "admin",
      activity: "Actualización de usuarios",
      description:
        "Se actualizan usuarios de operación e inversiones en estaciones.",
      date: isoOffset(-2),
      time: "17:25",
      status: "ok",
    },
    {
      id: 9,
      user: "Jefe Estación Las Torres",
      role: "jefe_estacion",
      activity: "Cierre de turno",
      description:
        "Jefe de estación registra cierre general y novedades del día.",
      date: isoOffset(-1),
      time: "23:10",
      status: "ok",
    },
    {
      id: 10,
      user: "Administrador1",
      role: "admin",
      activity: "Exportación de respaldo",
      description:
        "Se genera respaldo completo de configuración y operación del sistema.",
      date: todayIso,
      time: "19:40",
      status: "ok",
    },
    {
      id: 11,
      user: "Jefe Estación Operación",
      role: "jefe_estacion",
      activity: "Revisión de KPIs mensuales",
      description:
        "Se revisan KPIs de incidentes y cumplimiento de checklist del mes.",
      date: isoOffset(-3),
      time: "11:55",
      status: "ok",
    },
  ];

  adminState.users = [
    // Administrador general del sistema
    {
      id: 1,
      name: "Administrador1",
      username: "admin1",
      password: "admin123",
      role: "admin",
      stationId: "",
      area: "Corporativo",
      passwordLastChanged: todayIso,
    },

    // Encargados de estación (jefes de estación)
    {
      id: 2,
      name: "Encargado Las Torres",
      username: "enc_torres",
      password: "torres123",
      role: "jefe_estacion",
      stationId: "st1",
      area: "Operación",
      passwordLastChanged: todayIso,
    },
    {
      id: 3,
      name: "Encargado Cumbres",
      username: "enc_cumbres",
      password: "cumbres123",
      role: "jefe_estacion",
      stationId: "st2",
      area: "Operación",
      passwordLastChanged: todayIso,
    },
    {
      id: 4,
      name: "Encargado Centro",
      username: "enc_centro",
      password: "centro123",
      role: "jefe_estacion",
      stationId: "st3",
      area: "Operación",
      passwordLastChanged: todayIso,
    },
    {
      id: 5,
      name: "Encargado Aeropuerto",
      username: "enc_aeropuerto",
      password: "aeropuerto123",
      role: "jefe_estacion",
      stationId: "st4",
      area: "Operación",
      passwordLastChanged: todayIso,
    },
    {
      id: 6,
      name: "Encargado Valle",
      username: "enc_valle",
      password: "valle123",
      role: "jefe_estacion",
      stationId: "st5",
      area: "Operación",
      passwordLastChanged: todayIso,
    },

    // Supervisor regional (ve varias estaciones)
    {
      id: 7,
      name: "Supervisor Regional",
      username: "sup_regional",
      password: "super123",
      role: "supervisor",
      stationId: "",
      area: "Operación",
      passwordLastChanged: todayIso,
    },

    // Operadores Gasolinera Las Torres
    {
      id: 8,
      name: "Operador Torres 1",
      username: "op_torres1",
      password: "op123",
      role: "empleado",
      stationId: "st1",
      area: "Operación",
    },
    {
      id: 9,
      name: "Operador Torres 2",
      username: "op_torres2",
      password: "op123",
      role: "empleado",
      stationId: "st1",
      area: "Operación",
    },
    {
      id: 10,
      name: "Operador Torres 3",
      username: "op_torres3",
      password: "op123",
      role: "empleado",
      stationId: "st1",
      area: "Operación",
    },

    // Operadores Gasolinera Cumbres
    {
      id: 11,
      name: "Operador Cumbres 1",
      username: "op_cumbres1",
      password: "op123",
      role: "empleado",
      stationId: "st2",
      area: "Operación",
    },
    {
      id: 12,
      name: "Operador Cumbres 2",
      username: "op_cumbres2",
      password: "op123",
      role: "empleado",
      stationId: "st2",
      area: "Operación",
    },
    {
      id: 13,
      name: "Operador Cumbres 3",
      username: "op_cumbres3",
      password: "op123",
      role: "empleado",
      stationId: "st2",
      area: "Operación",
    },

    // Operadores Gasolinera Centro
    {
      id: 14,
      name: "Operador Centro 1",
      username: "op_centro1",
      password: "op123",
      role: "empleado",
      stationId: "st3",
      area: "Operación",
    },
    {
      id: 15,
      name: "Operador Centro 2",
      username: "op_centro2",
      password: "op123",
      role: "empleado",
      stationId: "st3",
      area: "Operación",
    },
    {
      id: 16,
      name: "Operador Centro 3",
      username: "op_centro3",
      password: "op123",
      role: "empleado",
      stationId: "st3",
      area: "Operación",
    },

    // Operadores Gasolinera Aeropuerto
    {
      id: 17,
      name: "Operador Aeropuerto 1",
      username: "op_aeropuerto1",
      password: "op123",
      role: "empleado",
      stationId: "st4",
      area: "Operación",
    },
    {
      id: 18,
      name: "Operador Aeropuerto 2",
      username: "op_aeropuerto2",
      password: "op123",
      role: "empleado",
      stationId: "st4",
      area: "Operación",
    },
    {
      id: 19,
      name: "Operador Aeropuerto 3",
      username: "op_aeropuerto3",
      password: "op123",
      role: "empleado",
      stationId: "st4",
      area: "Operación",
    },

    // Operadores Gasolinera Valle Oriente
    {
      id: 20,
      name: "Operador Valle 1",
      username: "op_valle1",
      password: "op123",
      role: "empleado",
      stationId: "st5",
      area: "Operación",
    },
    {
      id: 21,
      name: "Operador Valle 2",
      username: "op_valle2",
      password: "op123",
      role: "empleado",
      stationId: "st5",
      area: "Operación",
    },
    {
      id: 22,
      name: "Operador Valle 3",
      username: "op_valle3",
      password: "op123",
      role: "empleado",
      stationId: "st5",
      area: "Operación",
    },

    // Auditores (comparten actividades entre estaciones)
    {
      id: 23,
      name: "Auditor Operativo",
      username: "aud_operativo",
      password: "auditor123",
      role: "auditor",
      stationId: "",
      area: "Seguridad",
    },
    {
      id: 24,
      name: "Auditor Seguridad",
      username: "aud_seguridad",
      password: "auditor123",
      role: "auditor",
      stationId: "",
      area: "Seguridad",
    },
  ];

  adminState.shifts = [
    {
      id: 1,
      stationId: "st1",
      date: todayIso,
      shift: "matutino",
      entregaPor: "Luis Ramirez",
      recibePor: "Jefe Estación Las Torres",
      novedades: "Turno sin incidentes, niveles dentro de rango.",
    },
    {
      id: 2,
      stationId: "st2",
      date: todayIso,
      shift: "nocturno",
      entregaPor: "Carlos Pérez",
      recibePor: "Jefe Estación Seguridad",
      novedades: "Se reporta falla intermitente en luminaria del andén norte.",
    },
    {
      id: 3,
      stationId: "st1",
      date: isoOffset(-1),
      shift: "vespertino",
      entregaPor: "María González",
      recibePor: "Patricia Mendoza",
      novedades:
        "Se entregan pendientes de inventario de tienda y limpieza ligera.",
    },
    {
      id: 4,
      stationId: "st2",
      date: isoOffset(-1),
      shift: "matutino",
      entregaPor: "Operador Cumbres 1",
      recibePor: "Miguel Torres",
      novedades:
        "Se revisan recomendaciones de auditoría y se programan acciones.",
    },
    {
      id: 5,
      stationId: "st1",
      date: isoOffset(-2),
      shift: "matutino",
      entregaPor: "Luis Ramirez",
      recibePor: "Jefe Estación Las Torres",
      novedades: "Turno con alto flujo, sin incidentes relevantes.",
    },
  ];
}

function resolveAssignedStationId() {
  if (
    !currentUser ||
    currentUser.role !== "jefe_estacion"
  ) {
    assignedStationId = "";
    window.localStorage.removeItem(`${AUTH_KEY}-stationId`);
    return "";
  }

  let stored = window.localStorage.getItem(`${AUTH_KEY}-stationId`) || "";
  const exists = stored && adminState.stations.some((s) => s.id === stored);

  if (!exists) {
    stored = adminState.stations[0] ? adminState.stations[0].id : "";
  }

  assignedStationId = stored;
  if (stored) {
    window.localStorage.setItem(`${AUTH_KEY}-stationId`, stored);
  }
  return stored;
}

function isPasswordChangeForced() {
  try {
    return (
      typeof AUTH_KEY !== "undefined" &&
      window.localStorage.getItem(`${AUTH_KEY}-mustChangePassword`) === "1"
    );
  } catch (e) {
    return false;
  }
}

function setAdminView(viewKey) {
  if (viewKey !== "profile" && isPasswordChangeForced()) {
    showToast(
      "Debes actualizar tu contraseña antes de usar el panel.",
      "warning"
    );
    viewKey = "profile";
  }

  const map = {
    dashboard: "admin-view-dashboard",
    logs: "admin-view-logs",
    alerts: "admin-view-alerts",
    "system-log": "admin-view-system-log",
    general: "admin-view-general",
    activities: "admin-view-activities",
    management: "admin-view-management",
    users: "admin-view-users",
    profile: "admin-view-profile",
    stations: "admin-view-stations",
    tv: "admin-view-tv",
  };

  const targetId = map[viewKey];
  if (!targetId) return;

  document
    .querySelectorAll(".admin-view")
    .forEach((v) => v.classList.toggle("is-active", v.id === targetId));

  document.querySelectorAll(".admin-sidebar-item").forEach((btn) => {
    const key = btn.getAttribute("data-view");
    btn.classList.toggle("is-active", key === viewKey);
  });

  if (viewKey === "logs") {
    renderLogs();
    if (!adminCalendar) {
      initAdminCalendar();
    } else {
      adminCalendar.updateSize();
      refreshAdminCalendarEvents();
    }
  }
  if (viewKey === "alerts") {
    renderAlerts();
  }
  if (viewKey === "general") renderGeneralLogs();
  if (viewKey === "activities") renderActivitiesView();
  if (viewKey === "stations") renderStations();
  if (viewKey === "dashboard") {
    hydrateDashboardStationSelect();
    renderDashboard();
  }
  if (viewKey === "system-log") renderMonthlyReport();
  if (viewKey === "users") {
    hydrateUserStationSelect();
    renderUsers();
  }
  if (viewKey === "management") {
    hydrateShiftStationSelect();
    renderShifts();
  }
   if (viewKey === "profile") {
    renderProfileView();
  }
  if (viewKey === "tv") {
    renderTvView();
  }
}

function formatDateShort(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function isPastDue(iso) {
  if (!iso) return false;
  const todayStr = new Date().toISOString().slice(0, 10);
  return iso < todayStr;
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

// Utilidad simple para evitar recalcular tablas muy pesadas en cada tecla
function debounce(func, wait) {
  let timeoutId;
  return function () {
    const context = this;
    const args = arguments;
    clearTimeout(timeoutId);
    timeoutId = window.setTimeout(function () {
      func.apply(context, args);
    }, wait);
  };
}

function buildActivitiesData() {
  const rawOps = window.localStorage.getItem(OPERATIONS_STORAGE_KEY);
  if (!rawOps) return [];

  try {
    const parsed = JSON.parse(rawOps);
    const employees = Array.isArray(parsed.employees) ? parsed.employees : [];
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

    const employeeById = new Map();
    employees.forEach((e) => {
      if (e && e.id) {
        employeeById.set(e.id, e);
      }
    });

    return tasks.map((t) => {
      const emp = employeeById.get(t.employeeId) || null;
      return {
        id: t.id,
        title: t.title || "",
        date: t.dueDate || "",
        time: t.dueTime || "",
        frequency: t.frequency || "unica",
        priority: t.priority || "media",
        status: t.status || "",
        manualUrl: t.manualUrl || "",
        evidenceUrl: t.evidenceUrl || "",
        notes: t.notes || "",
        employeeName: emp && emp.name ? emp.name : "-",
        stationLabel: emp && emp.station ? emp.station : t.station || "",
      };
    });
  } catch (e) {
    console.error("No se pudieron leer tareas para vista de actividades", e);
    return [];
  }
}

function renderActivitiesView() {
  const all = buildActivitiesData();

  const stationSelect = document.getElementById("activities-filter-station");
  const userSelect = document.getElementById("activities-filter-user");
  const statusSelect = document.getElementById("activities-filter-status");
  const fromInput = document.getElementById("activities-filter-from");
  const toInput = document.getElementById("activities-filter-to");
  const searchInput = document.getElementById("activities-search");
  const tbody = document.querySelector("#activities-table tbody");
  const activeFilters = document.getElementById("activities-active-filters");

  if (!tbody) return;

  // Poblar combos de estación y usuario a partir de los datos
  const stations = Array.from(
    new Set(
      all
        .map((a) => a.stationLabel || "")
        .filter((s) => s && typeof s === "string")
    )
  ).sort();
  const users = Array.from(
    new Set(
      all
        .map((a) => a.employeeName || "")
        .filter((u) => u && typeof u === "string")
    )
  ).sort();

  if (stationSelect) {
    const current = stationSelect.value;
    stationSelect.innerHTML = '<option value="">Todas</option>';
    stations.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      stationSelect.appendChild(opt);
    });
    stationSelect.value = current;
  }

  if (userSelect) {
    const current = userSelect.value;
    userSelect.innerHTML = '<option value="">Todos</option>';
    users.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u;
      opt.textContent = u;
      userSelect.appendChild(opt);
    });
    userSelect.value = current;
  }

  let filtered = all.slice();

  const stationVal = stationSelect ? stationSelect.value : "";
  const userVal = userSelect ? userSelect.value : "";
  const statusVal = statusSelect ? statusSelect.value : "";
  const fromVal = fromInput ? fromInput.value : "";
  const toVal = toInput ? toInput.value : "";
  const searchVal = searchInput
    ? searchInput.value.trim().toLowerCase()
    : "";

  if (stationVal) {
    filtered = filtered.filter((a) => a.stationLabel === stationVal);
  }
  if (userVal) {
    filtered = filtered.filter((a) => a.employeeName === userVal);
  }
  if (statusVal) {
    filtered = filtered.filter((a) => a.status === statusVal);
  }
  if (fromVal) {
    filtered = filtered.filter((a) => a.date && a.date >= fromVal);
  }
  if (toVal) {
    filtered = filtered.filter((a) => a.date && a.date <= toVal);
  }
  if (searchVal) {
    filtered = filtered.filter((a) => {
      return (
        (a.title || "").toLowerCase().includes(searchVal) ||
        (a.employeeName || "").toLowerCase().includes(searchVal) ||
        (a.stationLabel || "").toLowerCase().includes(searchVal)
      );
    });
  }

  // Chips de filtros activos
  if (activeFilters) {
    const chips = [];
    if (stationVal) chips.push({ key: "station", label: stationVal });
    if (userVal) chips.push({ key: "user", label: userVal });
    if (statusVal)
      chips.push({ key: "status", label: statusVal === "pendiente" ? "Pendiente" : statusVal === "en_progreso" ? "En progreso" : "Completada" });
    if (fromVal || toVal) {
      const label = `${fromVal || ""}${fromVal && toVal ? " → " : ""}${
        toVal || ""
      }`;
      chips.push({ key: "range", label });
    }

    activeFilters.innerHTML = "";
    if (!chips.length) {
      activeFilters.hidden = true;
    } else {
      activeFilters.hidden = false;
      chips.forEach((chip) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "filter-chip";
        el.dataset.key = chip.key;

        const spanLabel = document.createElement("span");
        spanLabel.className = "filter-chip-label";
        spanLabel.textContent = chip.label;

        const spanClear = document.createElement("span");
        spanClear.className = "filter-chip-clear";
        spanClear.textContent = "×";

        el.appendChild(spanLabel);
        el.appendChild(spanClear);
        activeFilters.appendChild(el);
      });
    }
  }

  tbody.innerHTML = "";

  if (!filtered.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 12;
    td.className = "admin-empty-row";
    td.textContent = "No hay actividades que coincidan con los filtros.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  filtered
    .slice()
    .sort((a, b) => {
      const da = (a.date || "") + "T" + (a.time || "");
      const db = (b.date || "") + "T" + (b.time || "");
      return da.localeCompare(db);
    })
    .forEach((a) => {
      const tr = document.createElement("tr");

      const cells = [
        a.id,
        a.stationLabel || "",
        a.employeeName || "",
        a.title || "",
        a.date || "",
        a.time || "",
        a.frequency || "unica",
        a.priority || "media",
        a.status || "",
        a.manualUrl || "",
        a.evidenceUrl || "",
        a.notes || "",
      ];

      cells.forEach((value, idx) => {
        const td = document.createElement("td");

        if (idx === 7) {
          // Prioridad
          const prio = (value || "").toString();
          if (prio) {
            const span = document.createElement("span");
            span.className = "badge-priority";
            if (prio === "alta") {
              span.classList.add("badge-priority-alta");
              span.textContent = "Alta";
            } else if (prio === "baja") {
              span.classList.add("badge-priority-baja");
              span.textContent = "Baja";
            } else {
              span.classList.add("badge-priority-media");
              span.textContent = "Media";
            }
            td.appendChild(span);
          }
        } else if (idx === 8) {
          // Estado
          const status = (value || "").toString();
          if (status) {
            const span = document.createElement("span");
            span.className = "badge-status";
            if (status === "pendiente") {
              span.classList.add("badge-status-warning");
              span.textContent = "Pendiente";
            } else if (status === "en_progreso") {
              span.classList.add("badge-status-ok");
              span.textContent = "En progreso";
            } else if (status === "completada") {
              span.classList.add("badge-status-ok");
              span.textContent = "Completada";
            } else {
              span.textContent = status;
            }
            td.appendChild(span);
          }
        } else if (idx === 9 || idx === 10) {
          // Manual / Evidencia: links
          const text = (value || "").toString();
          if (text) {
            if (/^https?:\/\//i.test(text)) {
              const a = document.createElement("a");
              a.href = text;
              a.target = "_blank";
              a.rel = "noopener noreferrer";
              a.textContent = "Abrir";
              td.appendChild(a);
            } else {
              td.textContent = text;
            }
          }
        } else if (idx === 11) {
          const text = (value || "").toString();
          td.textContent = text.length > 80 ? text.slice(0, 77) + "..." : text;
        } else {
          td.textContent = value != null ? String(value) : "";
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
}

function initActivitiesFilters() {
  const stationSelect = document.getElementById("activities-filter-station");
  const userSelect = document.getElementById("activities-filter-user");
  const statusSelect = document.getElementById("activities-filter-status");
  const fromInput = document.getElementById("activities-filter-from");
  const toInput = document.getElementById("activities-filter-to");
  const searchInput = document.getElementById("activities-search");
  const activeFilters = document.getElementById("activities-active-filters");

  const handler = () => renderActivitiesView();

  if (stationSelect) stationSelect.addEventListener("change", handler);
  if (userSelect) userSelect.addEventListener("change", handler);
  if (statusSelect) statusSelect.addEventListener("change", handler);
  if (fromInput) fromInput.addEventListener("change", handler);
  if (toInput) toInput.addEventListener("change", handler);
  if (searchInput) searchInput.addEventListener("input", handler);

  if (activeFilters) {
    activeFilters.addEventListener("click", (ev) => {
      const target = ev.target.closest(".filter-chip");
      if (!target) return;

      const key = target.dataset.key;
      if (key === "station" && stationSelect) stationSelect.value = "";
      if (key === "user" && userSelect) userSelect.value = "";
      if (key === "status" && statusSelect) statusSelect.value = "";
      if (key === "range") {
        if (fromInput) fromInput.value = "";
        if (toInput) toInput.value = "";
      }

      renderActivitiesView();
    });
  }
}

function renderTvView() {
  const today = getTodayIsoDate();

  const isStationScoped =
    currentUser && currentUser.role === "jefe_estacion";

  const scopeStationId = isStationScoped && assignedStationId ? assignedStationId : "";

  let logsToday = adminState.logs.filter((log) => log.date === today);
  if (scopeStationId) {
    logsToday = logsToday.filter((log) => log.stationId === scopeStationId);
  }

  const incidentsToday = logsToday.filter(
    (log) => log.status === "warning" || log.status === "error"
  );

  const todayCount = logsToday.length;
  const incidentsTodayCount = incidentsToday.length;

  const tvLogsTodayEl = document.getElementById("tv-logs-today");
  const tvIncTodayEl = document.getElementById("tv-incidents-today");
  const tvFuelTodayEl = document.getElementById("tv-fuel-today");
  const tvFuelTodaySubEl = document.getElementById("tv-fuel-today-sub");
  const tvFuelDaysSinceEl = document.getElementById("tv-fuel-days-since");
  const tvFuelDaysSinceSubEl = document.getElementById("tv-fuel-days-since-sub");
  const tvFuelTodayCard = document.getElementById("tv-card-fuel-today");
  const tvFuelRiskCard = document.getElementById("tv-card-fuel-risk");

  const animateNumber = (el, target) => {
    if (!el) return;
    const duration = 600;
    const start = 0;
    const startTime = performance.now();
    const currentTarget = Number(target) || 0;
    const step = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const value = Math.round(start + (currentTarget - start) * eased);
      el.textContent = String(value);
      if (t < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  };

  animateNumber(tvLogsTodayEl, todayCount);
  animateNumber(tvIncTodayEl, incidentsTodayCount);

  // Métricas de recepciones de pipa en modo TV
  const fuelToday = logsToday.filter((log) => {
    const isFuel =
      (log.incidentType || "") === "Recepción de pipa" ||
      (log.entry && String(log.entry).indexOf("Recepción de pipa") !== -1);
    return isFuel;
  });

  const fuelTodayCount = fuelToday.length;
  const fuelLitersToday = fuelToday.reduce((sum, log) => {
    const v = typeof log.fuelLiters === "number" ? log.fuelLiters : 0;
    return sum + (isNaN(v) ? 0 : v);
  }, 0);

  animateNumber(tvFuelTodayEl, fuelTodayCount);
  if (tvFuelTodaySubEl) {
    tvFuelTodaySubEl.textContent =
      fuelTodayCount > 0
        ? `${fuelLitersToday.toLocaleString("es-MX")} L recibidos hoy`
        : "Sin recepciones de pipa registradas hoy.";
  }

  // Incidentes del mes actual y comparación con mes anterior
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12

  function countIncidentsForPeriod(y, m) {
    return adminState.logs.filter((log) => {
      if (!log.date) return false;
      if (scopeStationId && log.stationId !== scopeStationId) return false;
      const [ly, lm] = log.date.split("-");
      const yy = Number(ly);
      const mm = Number(lm);
      if (yy !== y || mm !== m) return false;
      return log.status === "warning" || log.status === "error";
    }).length;
  }

  const currentMonthInc = countIncidentsForPeriod(year, month);
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const prevMonthInc = countIncidentsForPeriod(prevYear, prevMonth);
  const diff = currentMonthInc - prevMonthInc;
  const diffLabel =
    diff === 0 ? "sin cambio" : diff > 0 ? `+${diff}` : String(diff);

  const tvIncMonthEl = document.getElementById("tv-incidents-month");
  const tvIncMonthSubEl = document.getElementById("tv-incidents-month-sub");
  if (tvIncMonthEl) tvIncMonthEl.textContent = String(currentMonthInc);
  if (tvIncMonthSubEl)
    tvIncMonthSubEl.textContent = `Mes anterior: ${prevMonthInc} (${diffLabel}).`;

  // Incidentes sin seguimiento (warning/error sin comentarios)
  const noFollow = adminState.logs.filter((log) => {
    if (scopeStationId && log.stationId !== scopeStationId) return false;
    const isIncident = log.status === "warning" || log.status === "error";
    const commentsCount = Array.isArray(log.comments) ? log.comments.length : 0;
    return isIncident && commentsCount === 0;
  }).length;

  const tvNoFollowEl = document.getElementById("tv-incidents-nofollow");
  if (tvNoFollowEl) tvNoFollowEl.textContent = String(noFollow);

  // Subtítulo para incidentes de hoy
  const tvIncTodaySubEl = document.getElementById("tv-incidents-today-sub");
  if (tvIncTodaySubEl) {
    const pctToday = todayCount ? Math.round((incidentsTodayCount / todayCount) * 100) : 0;
    tvIncTodaySubEl.textContent = todayCount
      ? `${incidentsTodayCount} de ${todayCount} registros (${pctToday}%) son incidentes.`
      : "Sin registros cargados para hoy.";
  }

  // Resaltar tarjeta principal de TV si hay incidentes hoy
  const tvPrimaryCard = document.querySelector(".admin-tv-card-primary");
  if (tvPrimaryCard) {
    if (incidentsTodayCount > 0) {
      tvPrimaryCard.classList.add("admin-tv-card-pulse");
    } else {
      tvPrimaryCard.classList.remove("admin-tv-card-pulse");
    }
  }

  // Días desde la última recepción de pipa (todas las estaciones en alcance)
  let lastFuelDate = null;
  adminState.logs.forEach((log) => {
    const isFuel =
      (log.incidentType || "") === "Recepción de pipa" ||
      (log.entry && String(log.entry).indexOf("Recepción de pipa") !== -1);
    if (!isFuel || !log.date) return;
    if (scopeStationId && log.stationId !== scopeStationId) return;
    if (!lastFuelDate || log.date > lastFuelDate) {
      lastFuelDate = log.date;
    }
  });

  let daysSince = 0;
  if (lastFuelDate) {
    const last = new Date(lastFuelDate + "T00:00:00");
    const nowDate = new Date(today + "T00:00:00");
    const diffMs = nowDate.getTime() - last.getTime();
    daysSince = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }

  if (tvFuelDaysSinceEl) {
    tvFuelDaysSinceEl.textContent = String(daysSince);
  }
  if (tvFuelDaysSinceSubEl) {
    tvFuelDaysSinceSubEl.textContent = lastFuelDate
      ? `Última recepción: ${formatDateShort(lastFuelDate)}`
      : "Sin recepciones de pipa registradas.";
  }

  // Resaltar tarjetas de combustible según días desde la última pipa
  const fuelCards = [tvFuelTodayCard, tvFuelRiskCard];
  const fuelClasses = [
    "admin-tv-card-fuel-low",
    "admin-tv-card-fuel-medium",
    "admin-tv-card-fuel-high",
  ];
  fuelCards.forEach((card) => {
    if (!card) return;
    fuelClasses.forEach((cls) => card.classList.remove(cls));
  });

  if (lastFuelDate) {
    let levelClass = "";
    if (daysSince >= 6) levelClass = "admin-tv-card-fuel-high";
    else if (daysSince >= 3) levelClass = "admin-tv-card-fuel-medium";
    else levelClass = "admin-tv-card-fuel-low";

    fuelCards.forEach((card) => {
      if (!card || !levelClass) return;
      card.classList.add(levelClass);
    });
  }
}

function createStatusDots(status) {
  const wrapper = document.createElement("div");
  const dot1 = document.createElement("span");
  const dot2 = document.createElement("span");
  [dot1, dot2].forEach((dot) => {
    dot.style.display = "inline-block";
    dot.style.width = "10px";
    dot.style.height = "10px";
    dot.style.borderRadius = "999px";
    dot.style.marginLeft = "2px";
  });

  if (status === "ok") {
    dot1.style.background = "#22c55e";
    dot2.style.background = "#22c55e";
  } else if (status === "warning") {
    dot1.style.background = "#facc15";
    dot2.style.background = "#f97316";
  } else {
    dot1.style.background = "#ef4444";
    dot2.style.background = "#b91c1c";
  }

  wrapper.appendChild(dot1);
  wrapper.appendChild(dot2);
  return wrapper;
}

function renderLogs() {
  const tbody = document.querySelector("#log-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const searchEl = document.getElementById("log-search");
  const search = searchEl ? searchEl.value.trim().toLowerCase() : "";

  const filterStation = document.getElementById("log-filter-station");
  const filterStatus = document.getElementById("log-filter-status");
  const filterFreq = document.getElementById("log-filter-frequency");
  const filterFuelType = document.getElementById("log-filter-fueltype");
  const filterFrom = document.getElementById("log-filter-from");
  const filterTo = document.getElementById("log-filter-to");
  const filterShift = document.getElementById("log-filter-shift");
  const activeFiltersContainer = document.getElementById("logs-active-filters");

  const stationIdFilter = filterStation ? filterStation.value : "";
  const statusFilter = filterStatus ? filterStatus.value : "";
  const freqFilter = filterFreq ? filterFreq.value : "";
  const fuelTypeFilter = filterFuelType ? filterFuelType.value : "";
  const fromDate = filterFrom ? filterFrom.value : "";
  const toDate = filterTo ? filterTo.value : "";
  const shiftFilter = filterShift ? filterShift.value : "";

  // Guardar filtros actuales para futuras sesiones
  try {
    const filters = {
      stationId: stationIdFilter,
      status: statusFilter,
      frequency: freqFilter,
      fuelType: fuelTypeFilter,
      fromDate,
      toDate,
      shift: shiftFilter,
      search,
    };
    window.localStorage.setItem(LOG_FILTERS_KEY, JSON.stringify(filters));
  } catch (e) {
    // silencioso
  }

  // Mostrar chips de filtros activos
  if (activeFiltersContainer) {
    activeFiltersContainer.innerHTML = "";
    const chips = [];
    const pushChip = (label, value, clearFn) => {
      const chip = document.createElement("span");
      chip.className = "filter-chip";
      const spanLabel = document.createElement("span");
      spanLabel.className = "filter-chip-label";
      spanLabel.textContent = label + ":";
      const spanValue = document.createElement("span");
      spanValue.textContent = value;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip-clear";
      btn.textContent = "×";
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        clearFn();
      });
      chip.appendChild(spanLabel);
      chip.appendChild(spanValue);
      chip.appendChild(btn);
      chips.push(chip);
    };

    if (stationIdFilter && filterStation) {
      const opt = filterStation.options[filterStation.selectedIndex];
      pushChip("Estación", opt ? opt.textContent : stationIdFilter, () => {
        filterStation.value = "";
        renderLogs();
      });
    }
    if (statusFilter && filterStatus) {
      const opt = filterStatus.options[filterStatus.selectedIndex];
      pushChip("Estado", opt ? opt.textContent : statusFilter, () => {
        filterStatus.value = "";
        renderLogs();
      });
    }
    if (freqFilter && filterFreq) {
      const opt = filterFreq.options[filterFreq.selectedIndex];
      pushChip("Frecuencia", opt ? opt.textContent : freqFilter, () => {
        filterFreq.value = "";
        renderLogs();
      });
    }
    if (fuelTypeFilter && filterFuelType) {
      const opt = filterFuelType.options[filterFuelType.selectedIndex];
      pushChip(
        "Combustible",
        opt ? opt.textContent : fuelTypeFilter,
        () => {
          filterFuelType.value = "";
          renderLogs();
        }
      );
    }
    if (fromDate && filterFrom) {
      pushChip("Desde", fromDate, () => {
        filterFrom.value = "";
        renderLogs();
      });
    }
    if (toDate && filterTo) {
      pushChip("Hasta", toDate, () => {
        filterTo.value = "";
        renderLogs();
      });
    }
    if (shiftFilter && filterShift) {
      const opt = filterShift.options[filterShift.selectedIndex];
      pushChip("Turno", opt ? opt.textContent : shiftFilter, () => {
        filterShift.value = "";
        renderLogs();
      });
    }

    if (chips.length) {
      chips.forEach((c) => activeFiltersContainer.appendChild(c));
      activeFiltersContainer.hidden = false;
    } else {
      activeFiltersContainer.hidden = true;
    }
  }

  const filteredLogs = [];

  adminState.logs.forEach((log) => {
    const isStationScoped = currentUser && currentUser.role === "jefe_estacion";
    if (isStationScoped && assignedStationId && log.stationId !== assignedStationId) {
      return;
    }

    const station = adminState.stations.find((s) => s.id === log.stationId);
    const rowText = `${log.user} ${log.entry} ${log.description} ${
      station?.name || ""
    }`.toLowerCase();
    if (search && !rowText.includes(search)) return;

    if (stationIdFilter && log.stationId !== stationIdFilter) return;
    if (statusFilter && log.status !== statusFilter) return;

    const logFreq = log.frequency || "unica";
    if (freqFilter && logFreq !== freqFilter) return;

    if (fuelTypeFilter) {
      const isPipa =
        (log.incidentType && log.incidentType === "Recepción de pipa") ||
        (log.entry &&
          typeof log.entry === "string" &&
          log.entry.indexOf("Recepción de pipa") !== -1);
      if (!isPipa) return;

      const typeLabel = (log.fuelType || "").toString().toLowerCase();
      let matches = false;
      if (fuelTypeFilter === "magna") {
        matches =
          typeLabel.indexOf("magna") !== -1 ||
          typeLabel.indexOf("verde") !== -1;
      } else if (fuelTypeFilter === "premium") {
        matches =
          typeLabel.indexOf("premium") !== -1 ||
          typeLabel.indexOf("roja") !== -1;
      } else if (fuelTypeFilter === "diesel") {
        matches =
          typeLabel.indexOf("diésel") !== -1 ||
          typeLabel.indexOf("diesel") !== -1;
      } else if (fuelTypeFilter === "otro") {
        matches =
          !typeLabel ||
          (typeLabel.indexOf("magna") === -1 &&
            typeLabel.indexOf("verde") === -1 &&
            typeLabel.indexOf("premium") === -1 &&
            typeLabel.indexOf("roja") === -1 &&
            typeLabel.indexOf("diésel") === -1 &&
            typeLabel.indexOf("diesel") === -1);
      }

      if (!matches) return;
    }

    if (fromDate && (!log.date || log.date < fromDate)) return;
    if (toDate && (!log.date || log.date > toDate)) return;

    if (shiftFilter && log.shift !== shiftFilter) return;

    if (quickFilterOverdue) {
      const isOverdue = isPastDue(log.date) && log.status !== "ok";
      if (!isOverdue) return;
    }

    if (quickFilterIncidents) {
      const isIncident = log.status === "warning" || log.status === "error";
      if (!isIncident) return;
    }

    if (quickFilterLast7) {
      if (!log.date) return;
      const today = new Date();
      const from = new Date(today);
      from.setDate(today.getDate() - 6);
      const d = new Date(log.date + "T00:00:00");
      if (d < from || d > today) return;
    }

    if (quickFilterNoFollowUp) {
      const isIncident = log.status === "warning" || log.status === "error";
      const commentsCount = Array.isArray(log.comments)
        ? log.comments.length
        : 0;
      if (!isIncident || commentsCount > 0) return;
    }

    if (quickFilterFuelDeliveries) {
      const isPipa =
        (log.incidentType && log.incidentType === "Recepción de pipa") ||
        (log.entry &&
          typeof log.entry === "string" &&
          log.entry.indexOf("Recepción de pipa") !== -1);
      if (!isPipa) return;
    }

    if (quickFilterEvidence) {
      const hasEvidence = !!(
        log.evidenceUrl && String(log.evidenceUrl).trim() !== ""
      );
      if (!hasEvidence) return;
    }

    if (quickFilterSentToAdmin) {
      if (!log.sentToAdmin) return;
    }

    if (quickFilterEvidencePending) {
      const hasEvidence = !!(
        log.evidenceUrl && String(log.evidenceUrl).trim() !== ""
      );
      if (!hasEvidence || log.evidenceReviewed) return;
    }

    if (quickFilterHighSeverity) {
      if ((log.severity || "").toLowerCase() !== "alta") return;
    }

    filteredLogs.push(log);
  });

  const total = filteredLogs.length;
  const maxPage = total ? Math.ceil(total / LOG_PAGE_SIZE) : 1;
  if (logPage > maxPage) {
    logPage = maxPage;
  }
  if (logPage < 1) {
    logPage = 1;
  }

  const start = (logPage - 1) * LOG_PAGE_SIZE;
  const pageItems = filteredLogs.slice(start, start + LOG_PAGE_SIZE);

  if (!pageItems.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 14;
    td.className = "admin-empty-row";
    td.textContent = "Sin registros con los filtros actuales.";
    tr.appendChild(td);
    tbody.appendChild(tr);

    const infoEl = document.getElementById("log-pagination-info");
    if (infoEl) {
      infoEl.textContent = "0 registros";
    }
    const prevBtn = document.getElementById("log-page-prev");
    const nextBtn = document.getElementById("log-page-next");
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;

    refreshAdminCalendarEvents();
    return;
  }

  pageItems.forEach((log) => {
    const tr = document.createElement("tr");

    const overdue = isPastDue(log.date) && log.status !== "ok";
    if (overdue) {
      tr.classList.add("log-row-overdue");
    }

    const station = adminState.stations.find((s) => s.id === log.stationId);

    const cells = [
      log.id,
      log.user,
      station ? station.name : log.entry,
      log.description,
      log.manualUrl || "",
      log.evidenceUrl || "",
      (log.evidenceReviewed ? "Revisada" : "Pendiente"),
      formatDateShort(log.date),
      log.time,
      log.shift || "-",
      log.incidentType || "-",
      log.severity || "",
    ];

    cells.forEach((value, index) => {
      const td = document.createElement("td");

      // Columna Usuario clickable para filtro rápido por usuario
      if (index === 1) {
        td.style.cursor = "pointer";
        td.dataset.logUser = log.user;
      }

      // Columnas Manual / Evidencia: links clicables si son URL
      if (index === 4 || index === 5) {
        const text = (value || "").toString();
        if (text) {
          if (/^https?:\/\//i.test(text)) {
            const a = document.createElement("a");
            a.href = text;
            a.rel = "noopener noreferrer";
            a.textContent = "Abrir";
            a.classList.add("evidence-link");
            a.dataset.url = text;
            td.appendChild(a);
          } else {
            td.textContent = text;
          }
        } else {
          td.textContent = "";
        }
      }
      // Columna evidencia revisada (índice 6)
      else if (index === 6) {
        const select = document.createElement("select");
        select.className = "admin-select-inline";
        [
          { value: "pendiente", label: "Pendiente" },
          { value: "revisada", label: "Revisada" },
        ].forEach((optCfg) => {
          const opt = document.createElement("option");
          opt.value = optCfg.value;
          opt.textContent = optCfg.label;
          if (
            (log.evidenceReviewed ? "revisada" : "pendiente") === optCfg.value
          ) {
            opt.selected = true;
          }
          select.appendChild(opt);
        });

        select.addEventListener("change", (ev) => {
          ev.stopPropagation();
          const next = select.value === "revisada";
          log.evidenceReviewed = next;
          saveAdminState();
        });

        td.appendChild(select);
      }
      // Columna Severidad (última del arreglo, índice 11): usar chip de prioridad
      else if (index === 11) {
        const sevText = (value || "").toString().toLowerCase();
        if (sevText) {
          const span = document.createElement("span");
          span.className = "badge-priority";
          if (sevText === "alta") {
            span.classList.add("badge-priority-alta");
            span.textContent = "Alta";
          } else if (sevText === "media") {
            span.classList.add("badge-priority-media");
            span.textContent = "Media";
          } else if (sevText === "baja") {
            span.classList.add("badge-priority-baja");
            span.textContent = "Baja";
          } else {
            span.textContent = value || "";
          }
          td.appendChild(span);
        } else {
          td.textContent = "";
        }
      } else {
        td.textContent = value || "";
      }

      tr.appendChild(td);
    });

    const statusTd1 = document.createElement("td");
    const statusTd2 = document.createElement("td");
    const commentsTd = document.createElement("td");

    statusTd1.textContent =
      log.status === "ok"
        ? "OK"
        : log.status === "warning"
        ? "Advertencia"
        : log.status === "error"
        ? "Error"
        : "";

    statusTd1.classList.add("admin-status-label");
    if (log.status === "ok") statusTd1.classList.add("admin-status-ok");
    if (log.status === "warning") statusTd1.classList.add("admin-status-warning");
    if (log.status === "error") statusTd1.classList.add("admin-status-error");
    if (log.severity === "alta" && log.status === "error") {
      const wrapper = document.createElement("div");
      const stateSpan = document.createElement("span");
      const statusLabel =
        log.approvalStatus === "aprobado"
          ? "Aprobado"
          : "Pendiente firma";
      stateSpan.textContent = statusLabel;
      stateSpan.className =
        log.approvalStatus === "aprobado"
          ? "badge badge-done"
          : "badge badge-pending";
      wrapper.appendChild(stateSpan);

      if (
        log.approvalStatus !== "aprobado" &&
        currentUser &&
        (currentUser.role === "admin" || currentUser.role === "jefe_estacion")
      ) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ghost-btn";
        btn.textContent = "Aprobar";
        btn.style.marginLeft = "6px";
        btn.style.padding = "2px 6px";
        btn.style.fontSize = "11px";
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          log.approvalStatus = "aprobado";
          const now = new Date();
          log.approvedAt = now.toISOString();
          log.approvedByName = currentUser.name || "";
          log.approvedByRole = currentUser.role || "";
          saveAdminState();
          addGeneralLogEntry(
            "Aprobación de incidente",
            `El registro ${log.id} fue aprobado por ${
              currentUser.name || "usuario"
            } (severidad alta).`,
            "ok"
          );
          lastApprovedLogId = log.id;
          renderLogs();
        });
        wrapper.appendChild(btn);
      }

      statusTd2.appendChild(wrapper);
    } else {
      statusTd2.appendChild(createStatusDots(log.status));
    }
    const commentsBtn = document.createElement("button");
    commentsBtn.type = "button";
    commentsBtn.className = "ghost-btn";
    const commentsCount = Array.isArray(log.comments) ? log.comments.length : 0;
    commentsBtn.textContent = commentsCount ? `Ver (${commentsCount})` : "Ver";
    commentsBtn.style.padding = "4px 8px";
    commentsBtn.style.fontSize = "11px";
    commentsBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openLogComments(log.id);
    });
    commentsTd.appendChild(commentsBtn);
    tr.appendChild(statusTd1);
    tr.appendChild(statusTd2);
    tr.appendChild(commentsTd);

    tbody.appendChild(tr);
  });

  const from = start + 1;
  const to = start + pageItems.length;
  const infoEl = document.getElementById("log-pagination-info");
  if (infoEl) {
    infoEl.textContent = `Mostrando ${from}-${to} de ${total}`;
  }
  const prevBtn = document.getElementById("log-page-prev");
  const nextBtn = document.getElementById("log-page-next");
  if (prevBtn) prevBtn.disabled = logPage <= 1;
  if (nextBtn) nextBtn.disabled = logPage >= maxPage;

  refreshAdminCalendarEvents();
}

function renderAlerts() {
  const tbody = document.querySelector("#alerts-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const searchEl = document.getElementById("alerts-search");
  const search = searchEl ? searchEl.value.trim().toLowerCase() : "";

  const stationSelect = document.getElementById("alerts-filter-station");
  const severitySelect = document.getElementById("alerts-filter-severity");
  const fromInput = document.getElementById("alerts-filter-from");
  const toInput = document.getElementById("alerts-filter-to");
  const sentOnlyInput = document.getElementById("alerts-filter-sent");
    const activeFiltersContainer = document.getElementById("alerts-active-filters");
  const evidenceSummaryEl = document.getElementById("alerts-evidence-summary");

  const stationIdFilter = stationSelect ? stationSelect.value : "";
  const severityFilter = severitySelect ? severitySelect.value : "";
  const fromDate = fromInput ? fromInput.value : "";
  const toDate = toInput ? toInput.value : "";
  const sentOnly = !!(sentOnlyInput && sentOnlyInput.checked);

  // Opciones de estación (se regeneran rápido aquí)
  if (stationSelect && !stationSelect.dataset.hydrated) {
    stationSelect.innerHTML = "";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "Todas";
    stationSelect.appendChild(defaultOpt);

    adminState.stations.forEach((st) => {
      const opt = document.createElement("option");
      opt.value = st.id;
      opt.textContent = st.name;
      stationSelect.appendChild(opt);
    });

    stationSelect.dataset.hydrated = "1";
  }

  const rows = [];

  adminState.logs.forEach((log) => {
    // Consideramos alerta cualquier registro con estado warning/error o severidad marcada
    const isIncident =
      log.status === "warning" ||
      log.status === "error" ||
      !!(log.severity && log.severity !== "");
    if (!isIncident) return;

    const station = adminState.stations.find((s) => s.id === log.stationId);

    if (stationIdFilter && log.stationId !== stationIdFilter) return;
    if (severityFilter && log.severity !== severityFilter) return;

    if (sentOnly && !log.sentToAdmin) return;

    if (fromDate && (!log.date || log.date < fromDate)) return;
    if (toDate && (!log.date || log.date > toDate)) return;

    const rowText = `${log.user} ${log.entry} ${log.description} ${
      log.incidentType || ""
    } ${station ? station.name : ""}`
      .toLowerCase();
    if (search && !rowText.includes(search)) return;

    rows.push({ log, station });
  });

  if (evidenceSummaryEl) {
    const withEvidence = rows.filter(({ log }) =>
      log.evidenceUrl && String(log.evidenceUrl).trim() !== ""
    ).length;
    evidenceSummaryEl.textContent = `Alertas con evidencia: ${withEvidence}`;
  }

  // Chips de filtros activos en Alertas
  if (activeFiltersContainer) {
    activeFiltersContainer.innerHTML = "";
    const chips = [];
    const pushChip = (label, value, clearFn) => {
      const chip = document.createElement("span");
      chip.className = "filter-chip";
      const spanLabel = document.createElement("span");
      spanLabel.className = "filter-chip-label";
      spanLabel.textContent = label + ":";
      const spanValue = document.createElement("span");
      spanValue.textContent = value;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip-clear";
      btn.textContent = "×";
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        clearFn();
      });
      chip.appendChild(spanLabel);
      chip.appendChild(spanValue);
      chip.appendChild(btn);
      chips.push(chip);
    };

    if (stationIdFilter && stationSelect) {
      const opt = stationSelect.options[stationSelect.selectedIndex];
      pushChip("Estación", opt ? opt.textContent : stationIdFilter, () => {
        stationSelect.value = "";
        renderAlerts();
      });
    }
    if (severityFilter && severitySelect) {
      const opt = severitySelect.options[severitySelect.selectedIndex];
      pushChip("Severidad", opt ? opt.textContent : severityFilter, () => {
        severitySelect.value = "";
        renderAlerts();
      });
    }
    if (fromDate && fromInput) {
      pushChip("Desde", fromDate, () => {
        fromInput.value = "";
        renderAlerts();
      });
    }
    if (toDate && toInput) {
      pushChip("Hasta", toDate, () => {
        toInput.value = "";
        renderAlerts();
      });
    }
    if (sentOnly && sentOnlyInput) {
      pushChip("Solo enviados", "Sí", () => {
        sentOnlyInput.checked = false;
        renderAlerts();
      });
    }

    if (chips.length) {
      chips.forEach((c) => activeFiltersContainer.appendChild(c));
      activeFiltersContainer.hidden = false;
    } else {
      activeFiltersContainer.hidden = true;
    }
  }

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.className = "admin-empty-row";
    td.textContent = "Sin alertas o incidentes con los filtros actuales.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  rows
    .slice()
    .sort((a, b) => {
      const ad = a.log.date || "";
      const bd = b.log.date || "";
      const at = a.log.time || "";
      const bt = b.log.time || "";
      const k1 = ad + at;
      const k2 = bd + bt;
      return k2.localeCompare(k1); // más recientes primero
    })
    .forEach(({ log, station }) => {
      const tr = document.createElement("tr");

      // Estilos visuales según severidad del incidente
      const sev = (log.severity || "").toLowerCase();
      tr.classList.add("alerts-row");
      if (sev === "alta") {
        tr.classList.add("alerts-row-high");
      } else if (sev === "media") {
        tr.classList.add("alerts-row-medium");
      } else if (sev === "baja") {
        tr.classList.add("alerts-row-low");
      }

      // Resaltar si fue enviado al administrador
      if (log.sentToAdmin) {
        tr.classList.add("alerts-row-sent");
      }

      const sentLabel = log.sentToAdmin ? "📩 Sí" : "No";

      const cells = [
        log.id,
        station ? station.name : "",
        log.user,
        log.description,
        log.incidentType || "-",
        log.severity || "",
        log.evidenceUrl || "",
        sentLabel,
        formatDateShort(log.date),
        log.time || "",
        log.status === "ok"
          ? "OK"
          : log.status === "warning"
          ? "Advertencia"
          : log.status === "error"
          ? "Error"
          : "",
      ];

      cells.forEach((value, idx) => {
        const td = document.createElement("td");

        // Columna Severidad (índice 5): mostrar chip de severidad
        if (idx === 5) {
          const sevText = (value || "").toString().toLowerCase();
          if (sevText) {
            const span = document.createElement("span");
            span.className = "badge-priority";
            if (sevText === "alta") {
              span.classList.add("badge-priority-alta");
              span.textContent = "Alta";
            } else if (sevText === "media") {
              span.classList.add("badge-priority-media");
              span.textContent = "Media";
            } else if (sevText === "baja") {
              span.classList.add("badge-priority-baja");
              span.textContent = "Baja";
            } else {
              span.textContent = value || "";
            }
            td.appendChild(span);
          } else {
            td.textContent = "";
          }
        } else if (idx === 6) {
          // Evidencia
          const text = (value || "").toString();
          if (text) {
            if (/^https?:\/\//i.test(text)) {
              const a = document.createElement("a");
              a.href = text;
              a.rel = "noopener noreferrer";
              a.textContent = "Abrir";
              a.classList.add("evidence-link");
              a.dataset.url = text;
              td.appendChild(a);
            } else {
              td.textContent = text;
            }
          } else {
            td.textContent = "";
          }
        } else if (idx === 10) {
          // Columna Estado (índice 10): badge de estado OK/Advertencia/Error
          const statusText = (value || "").toString().toLowerCase();
          if (statusText) {
            const span = document.createElement("span");
            span.className = "badge-status";
            if (statusText === "ok") {
              span.classList.add("badge-status-ok");
              span.textContent = "OK";
            } else if (statusText === "advertencia") {
              span.classList.add("badge-status-warning");
              span.textContent = "Advertencia";
            } else if (statusText === "error") {
              span.classList.add("badge-status-error");
              span.textContent = "Error";
            } else {
              span.textContent = value || "";
            }
            td.appendChild(span);
          } else {
            td.textContent = "";
          }
        } else {
          td.textContent = value || "";
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
}

function openLogComments(logId) {
  const log = adminState.logs.find((l) => l.id === logId);
  if (!log) return;

  currentCommentsLogId = logId;

  const backdrop = document.getElementById("log-comments-backdrop");
  const meta = document.getElementById("log-comments-meta");
  const list = document.getElementById("log-comments-list");
  const input = document.getElementById("log-comments-input");

  if (!backdrop || !meta || !list || !input) return;

  const station = adminState.stations.find((s) => s.id === log.stationId);
  meta.textContent = `${station ? station.name + " · " : ""}${
    log.user
  } · ${formatDateShort(log.date)} ${log.time || ""} - ${log.entry}`;

  list.innerHTML = "";
  const comments = Array.isArray(log.comments) ? log.comments : [];
  if (!comments.length) {
    const empty = document.createElement("div");
    empty.className = "admin-comment-empty";
    empty.textContent = "Sin comentarios aún. Añade el primero.";
    list.appendChild(empty);
  } else {
    comments.forEach((c) => {
      const item = document.createElement("div");
      item.className = "admin-comment-item";
      item.textContent = c;
      list.appendChild(item);
    });
  }

  input.value = "";
  backdrop.classList.remove("hidden");
}

function closeLogComments() {
  const backdrop = document.getElementById("log-comments-backdrop");
  if (backdrop) backdrop.classList.add("hidden");
  currentCommentsLogId = null;
}

function renderGeneralLogs() {
  const tbody = document.querySelector("#general-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const search = document
    .getElementById("general-search")
    .value.trim()
    .toLowerCase();

  adminState.generalLogs.forEach((log) => {
    const rowText = `${log.user} ${log.activity} ${log.description}`.toLowerCase();
    if (search && !rowText.includes(search)) return;

    const tr = document.createElement("tr");

    const idTd = document.createElement("td");
    idTd.textContent = String(log.id || "");
    const userTd = document.createElement("td");
    userTd.textContent = log.user || "";
    userTd.className = "admin-link-cell";
    userTd.style.cursor = "pointer";
    userTd.addEventListener("click", () => {
      const searchEl = document.getElementById("general-search");
      if (searchEl && log.user) {
        searchEl.value = log.user;
        renderGeneralLogs();
      }
    });
    const roleTd = document.createElement("td");
    roleTd.textContent = log.role || "";
    const activityTd = document.createElement("td");
    activityTd.textContent = log.activity || "";
    const descTd = document.createElement("td");
    descTd.textContent = log.description || "";
    const dateTd = document.createElement("td");
    dateTd.textContent = formatDateShort(log.date || "");
    const timeTd = document.createElement("td");
    timeTd.textContent = log.time || "";

    [idTd, userTd, roleTd, activityTd, descTd, dateTd, timeTd].forEach((td) => {
      tr.appendChild(td);
    });

    const statusTd1 = document.createElement("td");
    const statusTd2 = document.createElement("td");
    statusTd2.appendChild(createStatusDots(log.status));
    tr.appendChild(statusTd1);
    tr.appendChild(statusTd2);

    tbody.appendChild(tr);
  });
}

function renderStations() {
  const list = document.getElementById("stations-list");
  if (!list) return;
  list.innerHTML = "";

  const search = document
    .getElementById("station-search")
    .value.trim()
    .toLowerCase();

  const isJefeEstacion = currentUser && currentUser.role === "jefe_estacion";

  adminState.stations.forEach((st) => {
    if (isJefeEstacion && assignedStationId && st.id !== assignedStationId) {
      return;
    }
    const text = `${st.name} ${st.location} ${st.description}`.toLowerCase();
    if (search && !text.includes(search)) return;

    const card = document.createElement("article");
    card.className = "admin-station-card";

    const header = document.createElement("div");
    header.className = "admin-station-header";
    const nameEl = document.createElement("div");
    nameEl.className = "admin-station-name";
    nameEl.textContent = st.name;
    const meta = document.createElement("div");
    meta.className = "admin-station-meta";
    meta.textContent = st.location;
    header.appendChild(nameEl);
    header.appendChild(meta);

    const desc = document.createElement("div");
    desc.className = "admin-station-meta";
    desc.textContent = st.description;

    const employeesWrap = document.createElement("div");
    employeesWrap.className = "admin-station-employees";

    const employees = st.employees || [];

    if (employees.length) {
      const title = document.createElement("div");
      title.textContent = "Equipo:";
      title.style.fontWeight = "600";
      const list = document.createElement("div");
      list.textContent = employees
        .map((e) => `${e.name} (${e.role})`)
        .join(", ");
      employeesWrap.appendChild(title);
      employeesWrap.appendChild(list);
    } else {
      employeesWrap.textContent = "Sin operadores asignados";
    }

    card.appendChild(header);
    card.appendChild(desc);
    card.appendChild(employeesWrap);

    list.appendChild(card);
  });
}

function renderShifts() {
  const tbody = document.querySelector("#shift-table tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const isStationScoped =
    currentUser && currentUser.role === "jefe_estacion";

  let shifts = [...(adminState.shifts || [])];

  if (isStationScoped && assignedStationId) {
    shifts = shifts.filter((s) => s.stationId === assignedStationId);
  }

  shifts
    .slice()
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .forEach((s) => {
      const tr = document.createElement("tr");
      const station = adminState.stations.find((st) => st.id === s.stationId);

      const cells = [
        s.id,
        station ? station.name : "",
        formatDateShort(s.date),
        s.shift || "",
        s.entregaPor || "",
        s.recibePor || "",
        s.novedades || "",
      ];

      cells.forEach((value) => {
        const td = document.createElement("td");
        td.textContent = value || "";
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
}

function renderUsers() {
  const tbody = document.querySelector("#users-table tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const total = adminState.users.length;
  const maxPage = total ? Math.ceil(total / USERS_PAGE_SIZE) : 1;
  if (usersPage > maxPage) {
    usersPage = maxPage;
  }
  if (usersPage < 1) {
    usersPage = 1;
  }

  const start = (usersPage - 1) * USERS_PAGE_SIZE;
  const pageItems = adminState.users.slice(start, start + USERS_PAGE_SIZE);

  if (!pageItems.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.className = "admin-empty-row";
    td.innerHTML =
      '<span class="admin-empty-row-icon">📭</span>' +
      '<span class="admin-empty-row-text">Sin registros con los filtros actuales.</span>';
    tr.appendChild(td);
    tbody.appendChild(tr);

    const infoEl = document.getElementById("users-pagination-info");
    if (infoEl) {
      infoEl.textContent = "0 usuarios";
    }
    const prevBtn = document.getElementById("users-page-prev");
    const nextBtn = document.getElementById("users-page-next");
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  pageItems.forEach((user) => {
    const tr = document.createElement("tr");

    tr.dataset.userId = String(user.id);

    const station =
      user.stationId && adminState.stations.find((s) => s.id === user.stationId);

    let roleLabel = "";
    switch (user.role) {
      case "admin":
        roleLabel = "Administrador";
        break;
      case "jefe_estacion":
        roleLabel = "Jefe de estación";
        break;
      case "empleado":
        roleLabel = "Operador";
        break;
      case "auditor":
        roleLabel = "Auditor";
        break;
      case "supervisor":
        roleLabel = "Supervisor regional";
        break;
      default:
        roleLabel = user.role || "";
    }

    // ID
    const idTd = document.createElement("td");
    idTd.textContent = String(user.id);
    tr.appendChild(idTd);

    // Nombre
    const nameTd = document.createElement("td");
    nameTd.textContent = user.name || "";
    tr.appendChild(nameTd);

    // Usuario
    const usernameTd = document.createElement("td");
    usernameTd.textContent = user.username || "";
    tr.appendChild(usernameTd);

    // Contraseña (texto plano, uso interno admin)
    const passwordTd = document.createElement("td");
    passwordTd.textContent = user.password || "";
    tr.appendChild(passwordTd);

    // Rol (chip de color)
    const roleTd = document.createElement("td");
    const roleChip = document.createElement("span");
    roleChip.className = "role-chip";
    if (user.role === "admin") roleChip.classList.add("role-chip-admin");
    else if (user.role === "jefe_estacion")
      roleChip.classList.add("role-chip-jefe");
    else if (user.role === "empleado")
      roleChip.classList.add("role-chip-operador");
    else if (user.role === "auditor")
      roleChip.classList.add("role-chip-auditor");
    else if (user.role === "supervisor")
      roleChip.classList.add("role-chip-supervisor");
    roleChip.textContent = roleLabel;
    roleTd.appendChild(roleChip);
    tr.appendChild(roleTd);

    // Estación
    const stationTd = document.createElement("td");
    stationTd.textContent = station ? station.name : "Sin estación";
    tr.appendChild(stationTd);

    // Área
    const areaTd = document.createElement("td");
    areaTd.textContent = user.area || "";
    tr.appendChild(areaTd);

    tr.addEventListener("click", () => {
      document
        .querySelectorAll("#users-table tbody tr")
        .forEach((row) => row.classList.remove("is-selected"));
      tr.classList.add("is-selected");
      showUserSummary(user);
    });

    tbody.appendChild(tr);
  });

  const from = start + 1;
  const to = start + pageItems.length;
  const infoEl = document.getElementById("users-pagination-info");
  if (infoEl) {
    infoEl.textContent = `Mostrando ${from}-${to} de ${total}`;
  }
  const prevBtn = document.getElementById("users-page-prev");
  const nextBtn = document.getElementById("users-page-next");
  if (prevBtn) prevBtn.disabled = usersPage <= 1;
  if (nextBtn) nextBtn.disabled = usersPage >= maxPage;
}

function showUserSummary(user) {
  const placeholder = document.getElementById("user-summary-placeholder");
  const body = document.getElementById("user-summary-body");
  const tasksPanel = document.getElementById("user-tasks-panel");
  const tasksTableBody = document.querySelector("#user-tasks-table tbody");
  const profileAvatar = document.getElementById("profile-avatar");
  const profileNameEl = document.getElementById("profile-header-name");
  const profileRoleEl = document.getElementById("profile-header-role");
  const profileStationEl = document.getElementById("profile-header-station");
  if (!body) return;

  if (placeholder) {
    placeholder.style.display = "none";
  }

  body.hidden = false;
  body.innerHTML = "";

  if (tasksPanel && tasksTableBody) {
    tasksPanel.hidden = false;
    tasksTableBody.innerHTML = "";
  }

  const station =
    user.stationId && adminState.stations.find((s) => s.id === user.stationId);

  // Actualizar avatar y cabecera de perfil rápido con el usuario seleccionado
  if (profileAvatar && profileNameEl && profileRoleEl && profileStationEl) {
    profileAvatar.textContent = (user.name || "?")
      .split(" ")
      .map((p) => p.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase();
    profileAvatar.classList.remove(
      "profile-role-admin",
      "profile-role-jefe_estacion",
      "profile-role-empleado",
      "profile-role-auditor",
      "profile-avatar-pulse"
    );
    const roleClass = user.role ? `profile-role-${user.role}` : "";
    if (roleClass) {
      profileAvatar.classList.add(roleClass);
    }
    profileAvatar.classList.add("profile-avatar-pulse");

    profileNameEl.textContent = user.name || "Usuario";
    const roleLabelMap = {
      admin: "Administrador",
      jefe_estacion: "Jefe de estación",
      auditor: "Auditor",
      empleado: "Operador",
    };
    profileRoleEl.textContent = roleLabelMap[user.role] || "Rol";
    profileStationEl.textContent = station
      ? `Estación asignada: ${station.name}`
      : "Estación asignada: -";
  }

  // Métricas de logs
  const userLogs = adminState.logs.filter((l) => l.user === user.name);
  const totalLogs = userLogs.length;
  const okLogs = userLogs.filter((l) => l.status === "ok").length;
  const incidentLogs = userLogs.filter(
    (l) => l.status === "warning" || l.status === "error"
  ).length;
  const overdueLogs = userLogs.filter(
    (l) => isPastDue(l.date) && l.status !== "ok"
  ).length;

  // Métricas de tareas (si existe módulo de tareas en localStorage)
  let totalTasks = 0;
  let pendingTasks = 0;
  let inProgressTasks = 0;
  let doneTasks = 0;
  let overdueTasks = 0;

  let detailedTasks = [];

  try {
    const raw = window.localStorage.getItem("cog-work-log-data");
    if (raw) {
      const parsed = JSON.parse(raw);
      const employees = Array.isArray(parsed.employees) ? parsed.employees : [];
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

      const employeeIds = employees
        .filter((e) => e.name === user.name)
        .map((e) => e.id);

      if (employeeIds.length) {
        const userTasks = tasks.filter((t) => employeeIds.includes(t.employeeId));
        totalTasks = userTasks.length;
        pendingTasks = userTasks.filter((t) => t.status === "pendiente").length;
        inProgressTasks = userTasks.filter((t) => t.status === "en_progreso").length;
        doneTasks = userTasks.filter((t) => t.status === "completada").length;
        overdueTasks = userTasks.filter(
          (t) => t.dueDate && isPastDue(t.dueDate) && t.status !== "completada"
        ).length;

        // Guardar listado detallado ordenado por fecha y hora
        detailedTasks = userTasks
          .slice()
          .sort((a, b) => {
            const da = (a.dueDate || "") + "T" + (a.dueTime || "");
            const db = (b.dueDate || "") + "T" + (b.dueTime || "");
            return da.localeCompare(db);
          });
      }
    }
  } catch (e) {
    console.error("No se pudieron leer tareas para resumen de usuario", e);
  }

  const items = [
    {
      label: "Estación",
      value: station ? station.name : "Sin estación",
    },
    {
      label: "Logs registrados",
      value: String(totalLogs),
    },
    {
      label: "Logs con incidentes",
      value: String(incidentLogs),
    },
    {
      label: "Logs vencidos",
      value: String(overdueLogs),
    },
    {
      label: "Tareas asignadas",
      value: String(totalTasks),
    },
    {
      label: "Tareas pendientes",
      value: String(pendingTasks),
    },
    {
      label: "Tareas en progreso",
      value: String(inProgressTasks),
    },
    {
      label: "Tareas atrasadas",
      value: String(overdueTasks),
    },
  ];

  items.forEach((item) => {
    const box = document.createElement("div");
    box.className = "admin-user-summary-item";
    const label = document.createElement("span");
    label.className = "admin-user-summary-label";
    label.textContent = item.label;
    const value = document.createElement("div");
    value.className = "admin-user-summary-value";
    value.textContent = item.value;
    box.appendChild(label);
    box.appendChild(value);
    body.appendChild(box);
  });

  // Renderizar tabla de tareas detalladas, si existe el panel
  if (tasksPanel && tasksTableBody) {
    if (!detailedTasks.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 10;
      td.className = "admin-empty-row";
      td.textContent = "Este usuario no tiene tareas asignadas en el módulo operativo.";
      tr.appendChild(td);
      tasksTableBody.appendChild(tr);
    } else {
      detailedTasks.forEach((t) => {
        const tr = document.createElement("tr");
        const cells = [
          t.id,
          t.title || "",
          t.dueDate || "",
          t.dueTime || "",
          t.frequency || "unica",
          t.priority || "media",
          t.status || "",
          t.manualUrl || "",
          t.evidenceUrl || "",
          t.notes || "",
        ];

        cells.forEach((value, idx) => {
          const td = document.createElement("td");

          // Columna Estado
          if (idx === 6) {
            const status = (value || "").toString();
            if (status) {
              const span = document.createElement("span");
              span.className = "badge-status";
              if (status === "pendiente") {
                span.classList.add("badge-status-warning");
                span.textContent = "Pendiente";
              } else if (status === "en_progreso") {
                span.classList.add("badge-status-ok");
                span.textContent = "En progreso";
              } else if (status === "completada") {
                span.classList.add("badge-status-ok");
                span.textContent = "Completada";
              } else {
                span.textContent = status;
              }
              td.appendChild(span);
            }
          } else if (idx === 7 || idx === 8) {
            // Manual (PDF) o Evidencia: si parece enlace, mostrar link clicable
            const text = (value || "").toString();
            if (text) {
              if (/^https?:\/\//i.test(text)) {
                const a = document.createElement("a");
                a.href = text;
                a.rel = "noopener noreferrer";
                a.textContent = "Abrir";
                a.classList.add("evidence-link");
                a.dataset.url = text;
                td.appendChild(a);
              } else {
                td.textContent = text;
              }
            }
          } else if (idx === 9) {
            // Observaciones: mostrar texto acotado
            const text = (value || "").toString();
            td.textContent = text.length > 80 ? text.slice(0, 77) + "..." : text;
          } else {
            td.textContent = value != null ? String(value) : "";
          }

          tr.appendChild(td);
        });

        tasksTableBody.appendChild(tr);
      });
    }
  }
}

function buildAdminEvents() {
  const events = [];

  const isStationScoped =
    currentUser && currentUser.role === "jefe_estacion";

  const filterStation = document.getElementById("log-filter-station");
  const filterStatus = document.getElementById("log-filter-status");
  const filterFreq = document.getElementById("log-filter-frequency");
  const filterFrom = document.getElementById("log-filter-from");
  const filterTo = document.getElementById("log-filter-to");
  const filterShift = document.getElementById("log-filter-shift");

  const stationIdFilter = filterStation ? filterStation.value : "";
  const statusFilter = filterStatus ? filterStatus.value : "";
  const freqFilter = filterFreq ? filterFreq.value : "";
  const fromDate = filterFrom ? filterFrom.value : "";
  const toDate = filterTo ? filterTo.value : "";

  adminState.logs.forEach((log) => {
    if (isStationScoped && assignedStationId && log.stationId !== assignedStationId) {
      return;
    }

    if (stationIdFilter && log.stationId !== stationIdFilter) return;
    if (statusFilter && log.status !== statusFilter) return;

    const logFreq = log.frequency || "unica";
    if (freqFilter && logFreq !== freqFilter) return;

    if (fromDate && (!log.date || log.date < fromDate)) return;
    if (toDate && (!log.date || log.date > toDate)) return;

    const station = adminState.stations.find((s) => s.id === log.stationId);
    const title = station ? station.name : log.entry;
    const freq = log.frequency || "unica";
    const freqLabel =
      freq === "diaria"
        ? "D"
        : freq === "semanal"
        ? "S"
        : freq === "mensual"
        ? "M"
        : freq === "bimestral"
        ? "Bim"
        : freq === "trimestral"
        ? "Trim"
        : freq === "anual"
        ? "An"
        : "";

    const finalTitle = freqLabel ? `[${freqLabel}] ${title}` : title;

    const dateStr = log.date || "";
    const timeStr = log.time || "00:00";
    const start = dateStr ? `${dateStr}T${timeStr}` : undefined;

    let color = "#22c55e";
    if (log.status === "warning") color = "#facc15";
    if (log.status === "error") color = "#ef4444";
    if (isPastDue(log.date) && log.status !== "ok") {
      color = "#b91c1c";
    }

    events.push({
      id: `log-${log.id}`,
      title: finalTitle,
      start,
      extendedProps: {
        type: "log",
        user: log.user,
        description: log.description,
        stationName: station ? station.name : "",
        status: log.status,
        frequency: freq,
      },
      backgroundColor: color,
      borderColor: color,
    });
  });

  return events;
}

function initAdminCalendar() {
  const el = document.getElementById("admin-calendar");
  if (!el || typeof FullCalendar === "undefined") return;

  adminCalendar = new FullCalendar.Calendar(el, {
    initialView: "dayGridMonth",
    height: "100%",
    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,timeGridWeek,timeGridDay",
    },
    events: buildAdminEvents(),
    eventClick: (info) => {
      const props = info.event.extendedProps || {};
      const stationLine = props.stationName ? `${props.stationName} · ` : "";
      const userLine = props.user ? `${props.user}` : "";
      const desc = props.description ? `: ${props.description}` : "";
      const message = `${stationLine}${userLine}${desc}` || "Detalle de registro";
      showToast(message, "success");
    },
  });

  adminCalendar.render();
}

function refreshAdminCalendarEvents() {
  if (!adminCalendar) return;
  adminCalendar.removeAllEvents();
  const events = buildAdminEvents();
  events.forEach((e) => adminCalendar.addEvent(e));
}

function getFilteredLogsForExport() {
  const searchEl = document.getElementById("log-search");
  const search = searchEl ? searchEl.value.trim().toLowerCase() : "";

  const filterStation = document.getElementById("log-filter-station");
  const filterStatus = document.getElementById("log-filter-status");
  const filterFreq = document.getElementById("log-filter-frequency");
  const filterFrom = document.getElementById("log-filter-from");
  const filterTo = document.getElementById("log-filter-to");

  const stationIdFilter = filterStation ? filterStation.value : "";
  const statusFilter = filterStatus ? filterStatus.value : "";
  const freqFilter = filterFreq ? filterFreq.value : "";
  const fromDate = filterFrom ? filterFrom.value : "";
  const toDate = filterTo ? filterTo.value : "";

  const isStationScoped =
    currentUser && currentUser.role === "jefe_estacion";

  const result = [];

  adminState.logs.forEach((log) => {
    if (isStationScoped && assignedStationId && log.stationId !== assignedStationId) {
      return;
    }

    const station = adminState.stations.find((s) => s.id === log.stationId);
    const rowText = `${log.user} ${log.entry} ${log.description} ${
      station?.name || ""
    }`.toLowerCase();
    if (search && !rowText.includes(search)) return;

    if (stationIdFilter && log.stationId !== stationIdFilter) return;
    if (statusFilter && log.status !== statusFilter) return;

    const logFreq = log.frequency || "unica";
    if (freqFilter && logFreq !== freqFilter) return;

    if (fromDate && (!log.date || log.date < fromDate)) return;
    if (toDate && (!log.date || log.date > toDate)) return;

    result.push(log);
  });

  return result;
}

function exportLogsCsv() {
  const logs = getFilteredLogsForExport();
  if (!logs.length) {
    showToast("No hay registros para exportar con los filtros actuales.", "warning");
    return;
  }
  const header = [
    "ID",
    "Estacion",
    "Usuario",
    "Entrada",
    "Descripcion",
    "Fecha",
    "Hora",
    "Estado",
    "Frecuencia",
  ];

  const rows = logs.map((log) => {
    const station = adminState.stations.find((s) => s.id === log.stationId);
    return [
      log.id,
      station ? station.name : "",
      log.user,
      log.entry,
      log.description,
      log.date || "",
      log.time || "",
      log.status || "",
      log.frequency || "unica",
    ];
  });

  const csvLines = [
    header.join(","),
    ...rows.map((r) =>
      r
        .map((value) => {
          const v = value == null ? "" : String(value);
          const escaped = v.replace(/"/g, '""');
          return `"${escaped}"`;
        })
        .join(",")
    ),
  ];

  const blob = new Blob([csvLines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cog-work-log-bitacora.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportFuelLogsCsv() {
  const logs = getFilteredLogsForExport();
  const fuelLogs = logs.filter((log) => {
    const isFuel =
      (log.incidentType && log.incidentType === "Recepción de pipa") ||
      (log.entry &&
        typeof log.entry === "string" &&
        log.entry.indexOf("Recepción de pipa") !== -1);
    return isFuel;
  });

  if (!fuelLogs.length) {
    showToast(
      "No hay recepciones de pipa para exportar con los filtros actuales.",
      "warning"
    );
    return;
  }

  const header = [
    "ID",
    "Estacion",
    "Usuario",
    "Fecha",
    "Hora",
    "Combustible",
    "Litros",
    "Turno",
    "Estado",
  ];

  const rows = fuelLogs.map((log) => {
    const station = adminState.stations.find((s) => s.id === log.stationId);
    const liters =
      typeof log.fuelLiters === "number" && !isNaN(log.fuelLiters)
        ? log.fuelLiters
        : "";
    return [
      log.id,
      station ? station.name : "",
      log.user,
      log.date || "",
      log.time || "",
      log.fuelType || "",
      liters,
      log.shift || "",
      log.status || "",
    ];
  });

  const csvLines = [
    header.join(","),
    ...rows.map((r) =>
      r
        .map((value) => {
          const v = value == null ? "" : String(value);
          const escaped = v.replace(/"/g, '""');
          return `"${escaped}"`;
        })
        .join(",")
    ),
  ];

  const blob = new Blob([csvLines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cog-work-log-pipas.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function setupAdminEvents() {
  const sidebar = document.querySelector(".admin-sidebar-nav");
  if (sidebar) {
    sidebar.querySelectorAll(".admin-sidebar-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-view");
        if (!key) return;
        setAdminView(key);
      });
    });
  }

  // Clicks desde tarjetas del dashboard hacia la vista de registros
  const dashLiters = document.getElementById("dash-liters");
  const dashIncidents = document.getElementById("dash-incidents");
  const dashFuelRisk = document.getElementById("dash-fuel-risk");

  if (dashLiters) {
    dashLiters.style.cursor = "pointer";
    dashLiters.addEventListener("click", () => {
      setAdminView("logs");
      quickFilterLast7 = true;
      const quickLast7Btn = document.getElementById("btn-filter-last7");
      if (quickLast7Btn) {
        quickLast7Btn.classList.add("is-active");
      }
      renderLogs();
      showToast("Mostrando registros de los últimos 7 días.");
    });
  }

  if (dashIncidents) {
    dashIncidents.style.cursor = "pointer";
    dashIncidents.addEventListener("click", () => {
      setAdminView("logs");
      quickFilterIncidents = true;
      const quickIncidentsBtn = document.getElementById("btn-filter-incidents");
      if (quickIncidentsBtn) {
        quickIncidentsBtn.classList.add("is-active");
      }
      renderLogs();
      showToast("Mostrando solo incidentes para la estación seleccionada.");
    });
  }

  if (dashFuelRisk) {
    dashFuelRisk.style.cursor = "pointer";
    dashFuelRisk.addEventListener("click", () => {
      setAdminView("logs");
      quickFilterFuelDeliveries = true;
      const quickFuelBtn = document.getElementById("btn-filter-fuel");
      if (quickFuelBtn) {
        quickFuelBtn.classList.add("is-active");
      }
      renderLogs();
      showToast("Mostrando recepciones de pipa para revisar desabasto.");
    });
  }

  // Clicks desde tarjetas del Modo TV hacia vistas detalladas
  const tvIncidentsToday = document.getElementById("tv-incidents-today");
  if (tvIncidentsToday) {
    const card = tvIncidentsToday.closest(".admin-tv-card");
    if (card) {
      card.style.cursor = "pointer";
      card.addEventListener("click", () => {
        setAdminView("alerts");
        const todayIso = new Date().toISOString().slice(0, 10);
        const fromEl = document.getElementById("alerts-filter-from");
        const toEl = document.getElementById("alerts-filter-to");
        const stationEl = document.getElementById("alerts-filter-station");
        if (fromEl) fromEl.value = todayIso;
        if (toEl) toEl.value = todayIso;
        if (stationEl) stationEl.value = "";
        renderAlerts();
        showToast("Mostrando incidentes de hoy.");
      });
    }
  }

  const tvLogsToday = document.getElementById("tv-logs-today");
  if (tvLogsToday) {
    const card = tvLogsToday.closest(".admin-tv-card");
    if (card) {
      card.style.cursor = "pointer";
      card.addEventListener("click", () => {
        setAdminView("logs");
        const todayIso = new Date().toISOString().slice(0, 10);
        const fromEl = document.getElementById("log-filter-from");
        const toEl = document.getElementById("log-filter-to");
        if (fromEl) fromEl.value = todayIso;
        if (toEl) toEl.value = todayIso;
        renderLogs();
        showToast("Mostrando registros de hoy.");
      });
    }
  }

  const tvIncNoFollow = document.getElementById("tv-incidents-nofollow");
  if (tvIncNoFollow) {
    const card = tvIncNoFollow.closest(".admin-tv-card");
    if (card) {
      card.style.cursor = "pointer";
      card.addEventListener("click", () => {
        setAdminView("logs");
        quickFilterNoFollowUp = true;
        const btn = document.getElementById("btn-filter-nofollow");
        if (btn) {
          btn.classList.add("is-active");
        }
        renderLogs();
        showToast("Mostrando incidentes sin seguimiento.");
      });
    }
  }

  const tvFuelToday = document.getElementById("tv-fuel-today");
  if (tvFuelToday) {
    const card = tvFuelToday.closest(".admin-tv-card");
    if (card) {
      card.style.cursor = "pointer";
      card.addEventListener("click", () => {
        setAdminView("logs");
        quickFilterFuelDeliveries = true;
        const quickFuelBtn = document.getElementById("btn-filter-fuel");
        if (quickFuelBtn) {
          quickFuelBtn.classList.add("is-active");
        }
        const todayIso = new Date().toISOString().slice(0, 10);
        const fromEl = document.getElementById("log-filter-from");
        const toEl = document.getElementById("log-filter-to");
        if (fromEl) fromEl.value = todayIso;
        if (toEl) toEl.value = todayIso;
        renderLogs();
        showToast("Mostrando recepciones de pipa de hoy.");
      });
    }
  }

  const tvFuelDaysSince = document.getElementById("tv-fuel-days-since");
  if (tvFuelDaysSince) {
    const card = tvFuelDaysSince.closest(".admin-tv-card");
    if (card) {
      card.style.cursor = "pointer";
      card.addEventListener("click", () => {
        setAdminView("logs");
        quickFilterFuelDeliveries = true;
        const quickFuelBtn = document.getElementById("btn-filter-fuel");
        if (quickFuelBtn) {
          quickFuelBtn.classList.add("is-active");
        }
        const fromEl = document.getElementById("log-filter-from");
        const toEl = document.getElementById("log-filter-to");
        if (fromEl) fromEl.value = "";
        if (toEl) toEl.value = "";
        renderLogs();
        showToast("Mostrando historial de recepciones de pipa.");
      });
    }
  }

  const searchLog = document.getElementById("log-search");
  const debouncedRenderLogs = debounce(renderLogs, 180);
  const debouncedRenderAlerts = debounce(renderAlerts, 180);
  const debouncedRenderGeneralLogs = debounce(renderGeneralLogs, 180);
  const debouncedRenderStations = debounce(renderStations, 180);
  if (searchLog) {
    searchLog.addEventListener("input", debouncedRenderLogs);
  }

  const alertsSearch = document.getElementById("alerts-search");
  const alertsStation = document.getElementById("alerts-filter-station");
  const alertsSeverity = document.getElementById("alerts-filter-severity");
  const alertsFrom = document.getElementById("alerts-filter-from");
  const alertsTo = document.getElementById("alerts-filter-to");
  const alertsSent = document.getElementById("alerts-filter-sent");

  [
    alertsSearch,
    alertsStation,
    alertsSeverity,
    alertsFrom,
    alertsTo,
    alertsSent,
  ].forEach((el) => {
    if (!el) return;
    const evt = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
    el.addEventListener(evt, debouncedRenderAlerts);
  });

  const filterStation = document.getElementById("log-filter-station");
  const filterStatus = document.getElementById("log-filter-status");
  const filterFreq = document.getElementById("log-filter-frequency");
  const filterFrom = document.getElementById("log-filter-from");
  const filterTo = document.getElementById("log-filter-to");
  const filterShift = document.getElementById("log-filter-shift");

  // Restaurar filtros de bitácora desde la última sesión
  try {
    const rawFilters = window.localStorage.getItem(LOG_FILTERS_KEY);
    if (rawFilters) {
      const f = JSON.parse(rawFilters);
      if (filterStation && f.stationId) filterStation.value = f.stationId;
      if (filterStatus && f.status) filterStatus.value = f.status;
      if (filterFreq && f.frequency) filterFreq.value = f.frequency;
      if (filterFrom && f.fromDate) filterFrom.value = f.fromDate;
      if (filterTo && f.toDate) filterTo.value = f.toDate;
      if (filterShift && f.shift) filterShift.value = f.shift;
      if (searchLog && f.search) searchLog.value = f.search;
    }
  } catch (e) {
    // silencioso
  }

  [
    filterStation,
    filterStatus,
    filterFreq,
    document.getElementById("log-filter-fueltype"),
    filterFrom,
    filterTo,
    filterShift,
  ].forEach((el) => {
    if (!el) return;
    const evt = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(evt, debouncedRenderLogs);
  });

  const searchGeneral = document.getElementById("general-search");
  if (searchGeneral) {
    searchGeneral.addEventListener("input", debouncedRenderGeneralLogs);
  }

  const savedViewsSelect = document.getElementById("log-saved-view");
  const saveViewBtn = document.getElementById("btn-log-save-view");

  function loadSavedViews() {
    if (!savedViewsSelect) return;
    savedViewsSelect.innerHTML = "";
    const def = document.createElement("option");
    def.value = "";
    def.textContent = "Vistas guardadas";
    savedViewsSelect.appendChild(def);
    try {
      const raw = window.localStorage.getItem(LOG_SAVED_VIEWS_KEY);
      if (!raw) return;
      const views = JSON.parse(raw);
      if (!Array.isArray(views)) return;
      views.forEach((v) => {
        if (!v || !v.id || !v.name) return;
        const opt = document.createElement("option");
        opt.value = String(v.id);
        opt.textContent = v.name;
        savedViewsSelect.appendChild(opt);
      });
    } catch (e) {
      // silencioso
    }
  }

  function getCurrentLogFiltersFromStorage() {
    try {
      const raw = window.localStorage.getItem(LOG_FILTERS_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      // silencioso
    }
    return null;
  }

  if (savedViewsSelect) {
    loadSavedViews();
    savedViewsSelect.addEventListener("change", () => {
      const value = savedViewsSelect.value;
      if (!value) return;
      try {
        const raw = window.localStorage.getItem(LOG_SAVED_VIEWS_KEY);
        if (!raw) return;
        const views = JSON.parse(raw);
        if (!Array.isArray(views)) return;
        const selected = views.find((v) => String(v.id) === String(value));
        if (!selected || !selected.filters) return;

        const filters = selected.filters;
        const filterStationEl = document.getElementById("log-filter-station");
        const filterStatusEl = document.getElementById("log-filter-status");
        const filterFreqEl = document.getElementById("log-filter-frequency");
        const filterFuelTypeEl = document.getElementById("log-filter-fueltype");
        const filterFromEl = document.getElementById("log-filter-from");
        const filterToEl = document.getElementById("log-filter-to");
        const filterShiftEl = document.getElementById("log-filter-shift");
        const searchEl = document.getElementById("log-search");

        if (filterStationEl) filterStationEl.value = filters.stationId || "";
        if (filterStatusEl) filterStatusEl.value = filters.status || "";
        if (filterFreqEl) filterFreqEl.value = filters.frequency || "";
        if (filterFuelTypeEl) filterFuelTypeEl.value = filters.fuelType || "";
        if (filterFromEl) filterFromEl.value = filters.fromDate || "";
        if (filterToEl) filterToEl.value = filters.toDate || "";
        if (filterShiftEl) filterShiftEl.value = filters.shift || "";
        if (searchEl) searchEl.value = filters.search || "";

        renderLogs();
      } catch (e) {
        // silencioso
      }
    });
  }

  if (saveViewBtn) {
    saveViewBtn.addEventListener("click", () => {
      const filters = getCurrentLogFiltersFromStorage();
      if (!filters) {
        showToast(
          "Ajusta y aplica filtros de bitácora antes de guardar una vista.",
          "warning"
        );
        return;
      }
      const name = window.prompt("Nombre para la vista actual de bitácora:");
      if (!name) return;

      let views = [];
      try {
        const raw = window.localStorage.getItem(LOG_SAVED_VIEWS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            views = parsed;
          }
        }
      } catch (e) {
        views = [];
      }

      const nextId =
        views.reduce((max, v) => Math.max(max, v.id || 0), 0) + 1;
      views.push({ id: nextId, name, filters });
      try {
        window.localStorage.setItem(LOG_SAVED_VIEWS_KEY, JSON.stringify(views));
      } catch (e) {
        showToast("No se pudo guardar la vista.", "error");
        return;
      }
      loadSavedViews();
      showToast("Vista de bitácora guardada.");
    });
  }

  // Restaurar filtros de reporte mensual
  try {
    const stationSelect = document.getElementById("report-station");
    const monthInput = document.getElementById("report-month");
    const rawReportFilters = window.localStorage.getItem(REPORT_FILTERS_KEY);
    if (rawReportFilters) {
      const f = JSON.parse(rawReportFilters);
      if (stationSelect && f.stationId) stationSelect.value = f.stationId;
      if (monthInput && f.month) monthInput.value = f.month;
    }
  } catch (e) {
    // silencioso
  }

  const searchStation = document.getElementById("station-search");
  if (searchStation) {
    searchStation.addEventListener("input", debouncedRenderStations);
  }

  const globalSearchInput = document.getElementById("global-search-input");
  const globalSearchBtn = document.getElementById("global-search-btn");
  if (globalSearchInput) {
    globalSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        performGlobalSearch();
      }
    });
  }
  if (globalSearchBtn) {
    globalSearchBtn.addEventListener("click", () => {
      performGlobalSearch();
    });
  }

  const adminLogoutBtn = document.getElementById("admin-logout-btn");
  if (adminLogoutBtn) {
    adminLogoutBtn.addEventListener("click", () => {
      try {
        const generalLogs = Array.isArray(adminState.generalLogs)
          ? adminState.generalLogs
          : [];

        const nextId =
          generalLogs.reduce((max, l) => Math.max(max, l.id || 0), 0) + 1;
        const now = new Date();
        const date = now.toISOString().slice(0, 10);
        const time = now.toTimeString().slice(0, 5);

        const name = currentUser && currentUser.name ? currentUser.name : "Usuario";
        const role = currentUser && currentUser.role ? currentUser.role : "empleado";
        const username = currentUser && currentUser.username ? currentUser.username : "";

        generalLogs.push({
          id: nextId,
          user: name,
          role,
          activity: "Cierre de sesión",
          description: `Usuario ${username || name} cerró sesión (panel administración)`,
          date,
          time,
          status: "ok",
        });

        adminState.generalLogs = generalLogs;
        saveAdminState();
      } catch (err) {
        console.error("No se pudo registrar cierre de sesión admin en bitácora general", err);
      }

      if (typeof clearAuth === "function") {
        clearAuth();
      }
      window.location.href = "login.html";
    });
  }

  const adminHelpPanel = document.getElementById("admin-help-panel");
  const adminHelpClose = document.getElementById("admin-help-close");
  if (adminHelpPanel && adminHelpClose) {
    const list = adminHelpPanel.querySelector("ul");
    if (list && currentUser) {
      if (currentUser.role === "admin") {
        list.innerHTML = `
          <li><strong>Naves estado:</strong> resumen de bitácora y gráficas por estación.</li>
          <li><strong>Ver registros:</strong> bitácora detallada con filtros, calendario y comentarios.</li>
          <li><strong>Reporte mensual:</strong> concentrado por estación/mes e incidencias por severidad.</li>
          <li><strong>Gestión:</strong> entrega/recepción de turno.</li>
          <li><strong>Usuarios y estaciones:</strong> catálogos para controlar accesos y scoping.</li>
          <li><strong>Atajos:</strong> Ctrl+K abre la búsqueda global; Alt+1..9 cambia rápidamente entre vistas; / enfoca la búsqueda de registros.</li>
        `;
      } else if (currentUser.role === "jefe_estacion") {
        list.innerHTML = `
          <li><strong>Naves estado:</strong> resumen de la estación asignada.</li>
          <li><strong>Ver registros:</strong> bitácora solo de tu estación, con filtros y calendario.</li>
          <li><strong>Reporte mensual:</strong> indicadores mensuales de tu estación.</li>
          <li><strong>Gestión:</strong> registro de entrega/recepción de turnos de tu estación.</li>
        `;
      } else if (currentUser.role === "empleado") {
        list.innerHTML = `
          <li><strong>Naves estado:</strong> vista general de la estación.</li>
          <li><strong>Ver registros:</strong> consulta de bitácora, sin alta ni edición.</li>
          <li><strong>Mi perfil:</strong> usa el módulo de perfil para mantener tus datos al día.</li>
          <li><strong>Atajos:</strong> Ctrl+K abre la búsqueda global; Alt+1..9 cambia rápidamente entre vistas; / enfoca la búsqueda de registros.</li>
        `;
      }
    }

    const seen = window.sessionStorage.getItem("cog-work-log-admin-help-seen");
    if (!seen) {
      adminHelpPanel.style.display = "block";
      window.sessionStorage.setItem("cog-work-log-admin-help-seen", "1");
    }
    adminHelpClose.addEventListener("click", () => {
      adminHelpPanel.style.display = "none";
    });
  }

  const reportStation = document.getElementById("report-station");
  const reportMonth = document.getElementById("report-month");
  if (reportStation) {
    reportStation.addEventListener("change", renderMonthlyReport);
  }
  if (reportMonth) {
    reportMonth.addEventListener("change", renderMonthlyReport);
  }

  const logTableBody = document.querySelector("#log-table tbody");
  if (logTableBody) {
    logTableBody.addEventListener("click", (e) => {
      const td = e.target.closest("td");
      if (!td || !td.dataset.logUser) return;
      const userName = td.dataset.logUser;
      const searchEl = document.getElementById("log-search");
      if (searchEl) {
        searchEl.value = userName;
        renderLogs();
      }
    });
  }

  const commentsCancel = document.getElementById("log-comments-cancel");
  const commentsSave = document.getElementById("log-comments-save");
  const commentsTemplates = document.querySelectorAll(
    '.admin-comments-templates button[data-comment-template]'
  );
  if (commentsCancel) {
    commentsCancel.addEventListener("click", () => {
      closeLogComments();
    });
  }
  if (commentsTemplates && commentsTemplates.length) {
    commentsTemplates.forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = document.getElementById("log-comments-input");
        if (!input) return;
        const tmpl = btn.getAttribute("data-comment-template") || "";
        const current = input.value.trim();
        input.value = current ? `${current}\n${tmpl}` : tmpl;
        input.focus();
      });
    });
  }
  if (commentsSave) {
    commentsSave.addEventListener("click", () => {
      if (!can("commentLogs")) {
        showToast("No tienes permisos para agregar comentarios.", "error");
        return;
      }
      if (currentCommentsLogId == null) {
        closeLogComments();
        return;
      }
      const input = document.getElementById("log-comments-input");
      if (!input) return;
      const text = input.value.trim();
      if (!text) {
        closeLogComments();
        return;
      }
      const log = adminState.logs.find((l) => l.id === currentCommentsLogId);
      if (!log) {
        closeLogComments();
        return;
      }
      if (!Array.isArray(log.comments)) {
        log.comments = [];
      }
      log.comments.push(text);
      saveAdminState();
      openLogComments(log.id);
      lastCommentedLogId = log.id;
      renderLogs();
      showToast("Comentario agregado a la bitácora", "success");
    });
  }

  const logTemplateSelect = document.getElementById("log-template");
  if (logTemplateSelect) {
    logTemplateSelect.addEventListener("change", () => {
      const value = logTemplateSelect.value;
      const descInput = document.getElementById("log-desc");
      const statusSelect = document.getElementById("log-status");
      const freqSelect = document.getElementById("log-frequency");
      const shiftSelect = document.getElementById("log-shift");

      if (!value) return;

      if (value === "apertura" && descInput) {
        descInput.value =
          "Checklist de apertura: verificación de extintores, conos, señalización, equipos y niveles.";
        if (freqSelect) freqSelect.value = "diaria";
        if (shiftSelect) shiftSelect.value = "matutino";
        if (statusSelect) statusSelect.value = "ok";
      } else if (value === "cierre" && descInput) {
        descInput.value =
          "Checklist de cierre: arqueo de bombas, cierres de válvulas y aseguramiento de accesos.";
        if (freqSelect) freqSelect.value = "diaria";
        if (statusSelect) statusSelect.value = "ok";
      } else if (value === "ronda_seguridad" && descInput) {
        descInput.value =
          "Ronda de seguridad: recorrido perimetral, revisión de iluminación y cámaras.";
        if (freqSelect) freqSelect.value = "diaria";
        if (shiftSelect) shiftSelect.value = "nocturno";
        if (statusSelect) statusSelect.value = "ok";
      } else if (value === "descarga" && descInput) {
        descInput.value =
          "Recepción de autotanque: sellos, documentación, toma de muestra y conexión segura.";
        if (freqSelect) freqSelect.value = "unica";
        if (statusSelect) statusSelect.value = "warning";
      } else if (value === "incidente_menor" && descInput) {
        descInput.value =
          "Incidente menor: derrame controlado o anomalía sin afectación mayor.";
        if (freqSelect) freqSelect.value = "unica";
        if (statusSelect) statusSelect.value = "warning";
      }
    });
  }

  const toggleLogFormBtn = document.getElementById("btn-toggle-log-form");
  const logForm = document.getElementById("log-form");
  if (toggleLogFormBtn && logForm) {
    if (!can("createLog")) {
      toggleLogFormBtn.style.display = "none";
      logForm.classList.add("hidden");
    } else {
      toggleLogFormBtn.addEventListener("click", () => {
        logForm.classList.toggle("hidden");
      });
    }
  }

  const quickOverdue = document.getElementById("btn-filter-overdue");
  const quickIncidents = document.getElementById("btn-filter-incidents");
  const quickLast7 = document.getElementById("btn-filter-last7");
  const quickNoFollow = document.getElementById("btn-filter-nofollow");
  const quickFuel = document.getElementById("btn-filter-fuel");
  const quickEvidence = document.getElementById("btn-filter-evidence");
  const quickEvidencePendingBtn = document.getElementById("btn-filter-evidence-pending");
  const quickSent = document.getElementById("btn-filter-sent");
  const quickHighSev = document.getElementById("btn-filter-highsev");

  const shiftForm = document.getElementById("shift-form");

  if (quickOverdue) {
    quickOverdue.addEventListener("click", () => {
      quickFilterOverdue = !quickFilterOverdue;
      quickOverdue.classList.toggle("is-active", quickFilterOverdue);
      renderLogs();
    });
  }

  if (quickIncidents) {
    quickIncidents.addEventListener("click", () => {
      quickFilterIncidents = !quickFilterIncidents;
      quickIncidents.classList.toggle("is-active", quickFilterIncidents);
      renderLogs();
    });
  }

  if (quickLast7) {
    quickLast7.addEventListener("click", () => {
      quickFilterLast7 = !quickFilterLast7;
      quickLast7.classList.toggle("is-active", quickFilterLast7);
      renderLogs();
    });
  }

  if (quickNoFollow) {
    quickNoFollow.addEventListener("click", () => {
      quickFilterNoFollowUp = !quickFilterNoFollowUp;
      quickNoFollow.classList.toggle("is-active", quickFilterNoFollowUp);
      renderLogs();
    });
  }

  if (quickFuel) {
    quickFuel.addEventListener("click", () => {
      quickFilterFuelDeliveries = !quickFilterFuelDeliveries;
      quickFuel.classList.toggle("is-active", quickFilterFuelDeliveries);
      renderLogs();
    });
  }

  if (quickEvidence) {
    quickEvidence.addEventListener("click", () => {
      quickFilterEvidence = !quickFilterEvidence;
      quickEvidence.classList.toggle("is-active", quickFilterEvidence);
      renderLogs();
    });
  }

  if (quickEvidencePendingBtn) {
    quickEvidencePendingBtn.addEventListener("click", () => {
      quickFilterEvidencePending = !quickFilterEvidencePending;
      quickEvidencePendingBtn.classList.toggle(
        "is-active",
        quickFilterEvidencePending
      );
      renderLogs();
    });
  }

  if (quickSent) {
    quickSent.addEventListener("click", () => {
      quickFilterSentToAdmin = !quickFilterSentToAdmin;
      quickSent.classList.toggle("is-active", quickFilterSentToAdmin);
      renderLogs();
    });
  }

  if (quickHighSev) {
    quickHighSev.addEventListener("click", () => {
      quickFilterHighSeverity = !quickFilterHighSeverity;
      quickHighSev.classList.toggle("is-active", quickFilterHighSeverity);
      renderLogs();
    });
  }

  if (shiftForm) {
    shiftForm.addEventListener("submit", (e) => {
      e.preventDefault();

      if (!can("manageShifts")) {
        showToast("No tienes permisos para registrar turnos.", "error");
        return;
      }

      const stationId = document.getElementById("shift-station").value;
      const date = document.getElementById("shift-date").value;
      const shift = document.getElementById("shift-shift").value;
      const entregaPor = document.getElementById("shift-entrega").value.trim();
      const recibePor = document.getElementById("shift-recibe").value.trim();
      const novedades = document.getElementById("shift-notes").value.trim();

      if (!stationId || !date || !shift || !entregaPor || !recibePor) {
        showToast("Por favor completa todos los campos obligatorios del turno.", "error");
        return;
      }

      const nextId = adminState.shifts && adminState.shifts.length
        ? Math.max(...adminState.shifts.map((s) => s.id || 0)) + 1
        : 1;

      const newShift = {
        id: nextId,
        stationId,
        date,
        shift,
        entregaPor,
        recibePor,
        novedades,
      };

      adminState.shifts.push(newShift);
      saveAdminState();

      shiftForm.reset();
      hydrateShiftStationSelect();
      renderShifts();
      showToast("Turno registrado correctamente.");

      const station = adminState.stations.find((s) => s.id === stationId);
      const stationName = station ? station.name : stationId || "";
      addGeneralLogEntry(
        "Registro de turno",
        `Turno ${shift} registrado para la estación ${stationName} el ${date}. Entrega: ${entregaPor}. Recibe: ${recibePor}.`
      );
    });
  }

  const exportBtn = document.getElementById("btn-export-logs");
  if (exportBtn) {
    if (!can("exportLogs")) {
      exportBtn.style.display = "none";
    } else {
      exportBtn.addEventListener("click", () => {
        if (!can("exportLogs")) {
          showToast("No tienes permisos para exportar registros.", "error");
          return;
        }
        exportLogsCsv();
      });
    }
  }

  const exportFuelBtn = document.getElementById("btn-export-fuel-logs");
  if (exportFuelBtn) {
    if (!can("exportLogs")) {
      exportFuelBtn.style.display = "none";
    } else {
      exportFuelBtn.addEventListener("click", () => {
        if (!can("exportLogs")) {
          showToast("No tienes permisos para exportar registros.", "error");
          return;
        }
        exportFuelLogsCsv();
      });
    }
  }

  const logPrev = document.getElementById("log-page-prev");
  const logNext = document.getElementById("log-page-next");
  if (logPrev) {
    logPrev.addEventListener("click", () => {
      if (logPage > 1) {
        logPage -= 1;
        renderLogs();
      }
    });
  }
  if (logNext) {
    logNext.addEventListener("click", () => {
      logPage += 1;
      renderLogs();
    });
  }

  const printBtn = document.getElementById("btn-print-logs");
  if (printBtn) {
    if (!can("printLogs")) {
      printBtn.style.display = "none";
    } else {
      printBtn.addEventListener("click", () => {
        if (!can("printLogs")) {
          showToast("No tienes permisos para imprimir registros.", "error");
          return;
        }
        window.print();
      });
    }
  }

  const printReportBtn = document.getElementById("btn-print-report");
  if (printReportBtn) {
    if (!can("printLogs")) {
      printReportBtn.style.display = "none";
    } else {
      printReportBtn.addEventListener("click", () => {
        if (!can("printLogs")) {
          showToast("No tienes permisos para imprimir el reporte.", "error");
          return;
        }
        window.print();
      });
    }
  }

  const exportReportCsvBtn = document.getElementById("btn-export-report-csv");
  if (exportReportCsvBtn) {
    if (!can("exportLogs")) {
      exportReportCsvBtn.style.display = "none";
    } else {
      exportReportCsvBtn.addEventListener("click", () => {
        if (!can("exportLogs")) {
          showToast("No tienes permisos para exportar el reporte.", "error");
          return;
        }
        exportMonthlyReportCsv();
      });
    }
  }

  const exportBackupBtn = document.getElementById("btn-export-backup");
  if (exportBackupBtn) {
    if (!can("exportLogs")) {
      exportBackupBtn.style.display = "none";
    } else {
      exportBackupBtn.addEventListener("click", () => {
        if (!can("exportLogs")) {
          showToast("No tienes permisos para exportar respaldos.", "error");
          return;
        }

        try {
          const operationsRaw = window.localStorage.getItem(OPERATIONS_STORAGE_KEY);
          let operationsData = null;
          if (operationsRaw) {
            try {
              operationsData = JSON.parse(operationsRaw);
            } catch (e) {
              operationsData = null;
            }
          }

          const backup = {
            generatedAt: new Date().toISOString(),
            admin: adminState,
            operations: operationsData,
          };

          const blob = new Blob([JSON.stringify(backup, null, 2)], {
            type: "application/json;charset=utf-8;",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const now = new Date();
          const y = now.getFullYear();
          const m = String(now.getMonth() + 1).padStart(2, "0");
          const d = String(now.getDate()).padStart(2, "0");
          a.href = url;
          a.download = `cog-work-log-backup-${y}${m}${d}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          showToast("Respaldo JSON exportado.");
        } catch (e) {
          console.error("Error al generar respaldo", e);
          showToast("No se pudo generar el respaldo.", "error");
        }
      });
    }
  }

  const importBackupBtn = document.getElementById("btn-import-backup");
  const backupFileInput = document.getElementById("backup-file-input");
  if (importBackupBtn && backupFileInput) {
    if (!can("exportLogs") || !currentUser || currentUser.role !== "admin") {
      importBackupBtn.style.display = "none";
    } else {
      importBackupBtn.addEventListener("click", () => {
        backupFileInput.value = "";
        backupFileInput.click();
      });

      backupFileInput.addEventListener("change", () => {
        const file = backupFileInput.files && backupFileInput.files[0];
        if (!file) return;

        if (!file.name.toLowerCase().endsWith(".json")) {
          showToast("Selecciona un archivo JSON de respaldo.", "warning");
          backupFileInput.value = "";
          return;
        }

        const confirmMsg =
          "Esto reemplazará los datos actuales de administración y operación por el respaldo seleccionado. ¿Deseas continuar?";
        if (!window.confirm(confirmMsg)) {
          backupFileInput.value = "";
          return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const text = String((e && e.target && e.target.result) || "");
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== "object") {
              showToast("El archivo no parece ser un respaldo válido.", "error");
              return;
            }

            const adminPart = parsed.admin;
            const operationsPart = parsed.operations;
            if (!adminPart && !operationsPart) {
              showToast("El archivo no contiene datos de respaldo reconocibles.", "error");
              return;
            }

            if (adminPart) {
              window.localStorage.setItem(
                ADMIN_STORAGE_KEY,
                JSON.stringify(adminPart)
              );
            }
            if (operationsPart) {
              window.localStorage.setItem(
                OPERATIONS_STORAGE_KEY,
                JSON.stringify(operationsPart)
              );
            }

            showToast(
              "Respaldo importado correctamente. Se recargará el panel.",
              "success"
            );
            setTimeout(() => {
              window.location.reload();
            }, 700);
          } catch (err) {
            console.error("Error al importar respaldo", err);
            showToast(
              "No se pudo importar el respaldo. Verifica el archivo.",
              "error"
            );
          } finally {
            backupFileInput.value = "";
          }
        };

        reader.readAsText(file);
      });
    }
  }

  // Visor centralizado de evidencias (fotos / PDFs)
  const evidenceBackdrop = document.getElementById("evidence-viewer-backdrop");
  const evidenceContent = document.getElementById("evidence-viewer-content");
  const evidenceTitle = document.getElementById("evidence-viewer-title");
  const evidenceOpen = document.getElementById("evidence-viewer-open");
  const evidenceClose = document.getElementById("evidence-viewer-close");

  function openEvidenceViewer(url, title) {
    if (!evidenceBackdrop || !evidenceContent || !evidenceOpen) return;
    const safeUrl = url || "";
    const label = title || "Evidencia";

    if (evidenceTitle) evidenceTitle.textContent = label;
    evidenceOpen.href = safeUrl || "#";

    evidenceContent.innerHTML = "";
    if (safeUrl) {
      const lower = safeUrl.toLowerCase();
      if (lower.endsWith(".pdf")) {
        const iframe = document.createElement("iframe");
        iframe.src = safeUrl;
        evidenceContent.appendChild(iframe);
      } else {
        const img = document.createElement("img");
        img.src = safeUrl;
        img.alt = label;
        evidenceContent.appendChild(img);
      }
    }

    evidenceBackdrop.classList.remove("hidden");
  }

  if (evidenceClose && evidenceBackdrop) {
    evidenceClose.addEventListener("click", () => {
      evidenceBackdrop.classList.add("hidden");
    });
    evidenceBackdrop.addEventListener("click", (ev) => {
      if (ev.target === evidenceBackdrop) {
        evidenceBackdrop.classList.add("hidden");
      }
    });
  }

  document.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!target) return;
    const link = target.closest ? target.closest(".evidence-link") : null;
    if (!link) return;
    ev.preventDefault();
    const url = link.dataset.url || link.getAttribute("href") || "";
    openEvidenceViewer(url, "Evidencia");
  });

  const profileForm = document.getElementById("profile-form");
  if (profileForm) {
    profileForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!currentUser) return;

      const userRecord = getCurrentAdminUserRecord();

      const fullName = document.getElementById("profile-fullname").value.trim();
      const area = document.getElementById("profile-area").value.trim();
      const position = document.getElementById("profile-position").value.trim();
      const rfc = document.getElementById("profile-rfc").value.trim();
      const stationRfc = document
        .getElementById("profile-station-rfc")
        .value.trim();
      const email = document.getElementById("profile-email").value.trim();
      const phone = document.getElementById("profile-phone").value.trim();
      const photoUrl = document.getElementById("profile-photo").value.trim();

      const nameToUse = fullName || currentUser.name;

      if (!userRecord) {
        showToast(
          "No se encontró el usuario en el catálogo de administración.",
          "warning"
        );
      } else {
        userRecord.name = nameToUse;
        userRecord.area = area;
        userRecord.position = position;
        userRecord.rfc = rfc;
        userRecord.stationRfc = stationRfc;
        userRecord.email = email;
        userRecord.phone = phone;
        userRecord.photoUrl = photoUrl;

        saveAdminState();
      }

      currentUser.name = nameToUse;
      currentUser.area = area || currentUser.area;

      const storedUsername =
        (currentUser && currentUser.username) ||
        window.localStorage.getItem(`${AUTH_KEY}-username`) ||
        "";
      setAuthenticated(nameToUse, currentUser.role, currentUser.area, storedUsername);

      const userEl = document.querySelector(".admin-topbar-user");
      if (userEl) {
        let roleLabel = "Empleado";
        if (currentUser.role === "admin") roleLabel = "Administrador";
        else if (currentUser.role === "jefe_estacion") roleLabel = "Jefe de estación";
        else if (currentUser.role === "auditor") roleLabel = "Auditor";
        userEl.textContent = `${nameToUse} · ${roleLabel}`;
      }

      renderProfileView();
      showToast("Perfil actualizado correctamente.");
    });
  }

  const passwordForm = document.getElementById("profile-password-form");
  if (passwordForm) {
    passwordForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!currentUser) return;

      const userRecord = getCurrentAdminUserRecord();
      if (!userRecord || !userRecord.username) {
        showToast(
          "No se encontró el usuario en el catálogo de administración.",
          "warning"
        );
        return;
      }

      const currentPassInput = document
        .getElementById("profile-current-password")
        .value.trim();
      const newPassInput = document
        .getElementById("profile-new-password")
        .value.trim();
      const confirmPassInput = document
        .getElementById("profile-new-password-confirm")
        .value.trim();

      if (!currentPassInput || !newPassInput || !confirmPassInput) {
        showToast("Completa todos los campos de contraseña.", "warning");
        return;
      }

      if (userRecord.password && userRecord.password !== currentPassInput) {
        showToast("La contraseña actual no es correcta.", "error");
        return;
      }

      if (newPassInput !== confirmPassInput) {
        showToast("La confirmación no coincide con la nueva contraseña.", "error");
        return;
      }

      if (newPassInput === currentPassInput) {
        showToast(
          "La nueva contraseña debe ser diferente a la actual.",
          "warning"
        );
        return;
      }

      if (newPassInput.length < 8) {
        showToast(
          "La nueva contraseña debe tener al menos 8 caracteres.",
          "warning"
        );
        return;
      }

      if (!/[A-Z]/.test(newPassInput)) {
        showToast(
          "La nueva contraseña debe incluir al menos una letra mayúscula.",
          "warning"
        );
        return;
      }

      if (!/[a-z]/.test(newPassInput)) {
        showToast(
          "La nueva contraseña debe incluir al menos una letra minúscula.",
          "warning"
        );
        return;
      }

      if (!/[0-9]/.test(newPassInput)) {
        showToast(
          "La nueva contraseña debe incluir al menos un número.",
          "warning"
        );
        return;
      }

      userRecord.password = newPassInput;
      userRecord.passwordLastChanged = new Date().toISOString().slice(0, 10);
      saveAdminState();

      document.getElementById("profile-current-password").value = "";
      document.getElementById("profile-new-password").value = "";
      document.getElementById("profile-new-password-confirm").value = "";

      try {
        if (typeof AUTH_KEY !== "undefined") {
          window.localStorage.removeItem(`${AUTH_KEY}-mustChangePassword`);
        }
      } catch (e) {
        console.error("No se pudo limpiar la marca de contraseña expirada", e);
      }

      addGeneralLogEntry(
        "Cambio de contraseña",
        `El usuario ${userRecord.username} actualizó su contraseña desde Mi perfil.`,
        "ok"
      );

      showToast("Contraseña actualizada correctamente.");
    });
  }

  if (logForm) {
    logForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!can("createLog")) {
        showToast("No tienes permisos para crear registros de bitácora.", "error");
        return;
      }
      const stationId = document.getElementById("log-station").value;
      const user = document.getElementById("log-user").value.trim();
      const desc = document.getElementById("log-desc").value.trim();
      const date = document.getElementById("log-date").value;
      const time = document.getElementById("log-time").value;
      const status = document.getElementById("log-status").value;
      const frequency =
        document.getElementById("log-frequency").value || "unica";
      const shift = document.getElementById("log-shift").value || "matutino";
      const incidentType = document
        .getElementById("log-incident-type")
        .value.trim();
      const severity = document.getElementById("log-severity").value;
      const manualUrl = document
        .getElementById("log-manual-url")
        .value
        .trim();
      const evidenceUrl = document
        .getElementById("log-evidence-url")
        .value
        .trim();
      const sendToAdminCheckbox = document.getElementById("log-send-admin");
      const sentToAdmin = !!(sendToAdminCheckbox && sendToAdminCheckbox.checked);

      if (!stationId || !user || !desc) {
        showToast("Estación, usuario y descripción son obligatorios.", "warning");
        return;
      }

      const nextId =
        adminState.logs.reduce((max, l) => Math.max(max, l.id), 0) + 1;

      const now = new Date();
      const createdAt = now.toISOString();
      const creator = currentUser || {};

      const isCritical = status === "error" && severity === "alta";

      adminState.logs.push({
        id: nextId,
        stationId,
        user,
        entry: "Registro manual",
        description: desc,
        date,
        time,
        status,
        frequency,
        shift,
        incidentType,
        severity,
        manualUrl,
        evidenceUrl,
        createdAt,
        createdByName: creator.name || user,
        createdByUsername: creator.username || "",
        createdByRole: creator.role || "",
        approvalStatus: isCritical ? "pendiente" : "",
        sentToAdmin,
      });

      saveAdminState();
      logForm.reset();
      logForm.classList.add("hidden");
      renderLogs();
    });
  }

  const stationForm = document.getElementById("station-form");
  const stationClear = document.getElementById("station-clear");
  if (stationForm) {
    if (!can("manageStations")) {
      stationForm.style.display = "none";
    } else {
      stationForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = document.getElementById("station-name").value.trim();
        const location = document
          .getElementById("station-location")
          .value.trim();
        const desc = document.getElementById("station-desc").value.trim();

        if (!name) return;

        const id = `st${adminState.stations.length + 1}`;
        adminState.stations.push({
          id,
          name,
          location,
          description: desc,
          employees: [],
        });

        saveAdminState();
        stationForm.reset();
        renderStations();
        hydrateLogStationSelect();
        const filterStation = document.getElementById("log-filter-station");
        if (filterStation) {
          // Rehidratar opciones de filtro de estación
          filterStation.innerHTML = "";
          const defaultOpt = document.createElement("option");
          defaultOpt.value = "";
          defaultOpt.textContent = "Todas";
          filterStation.appendChild(defaultOpt);
          adminState.stations.forEach((st) => {
            const opt = document.createElement("option");
            opt.value = st.id;
            opt.textContent = st.name;
            filterStation.appendChild(opt);
          });
        }

        addGeneralLogEntry(
          "Alta de estacion",
          `Se creó la estación ${name} (ID: ${id}).`
        );
      });
    }
  }

  if (stationClear && can("manageStations")) {
    stationClear.addEventListener("click", () => {
      stationForm.reset();
    });
  }

  const userForm = document.getElementById("user-form");
  if (userForm) {
    if (!can("manageUsers")) {
      userForm.style.display = "none";
    } else {
      userForm.addEventListener("submit", (e) => {
        e.preventDefault();

        const name = document.getElementById("user-name").value.trim();
        const username = document.getElementById("user-username").value.trim();
        const password = document.getElementById("user-password").value.trim();
        const role = document.getElementById("user-role").value;
        const stationId = document.getElementById("user-station").value;
        const area = document.getElementById("user-area").value.trim();

        if (!name || !username || !role || !password) return;

        const nextId =
          adminState.users.reduce((max, u) => Math.max(max, u.id), 0) + 1;

        adminState.users.push({
          id: nextId,
          name,
          username,
          password,
          passwordLastChanged: new Date().toISOString(),
          role,
          stationId: stationId || "",
          area,
        });

        saveAdminState();
        userForm.reset();
        hydrateUserStationSelect();
        renderUsers();

        addGeneralLogEntry(
          "Alta de usuario",
          `Se creó el usuario ${username} (${name}) con rol ${role}.`
        );
      });
    }
  }

  const usersPrev = document.getElementById("users-page-prev");
  const usersNext = document.getElementById("users-page-next");
  if (usersPrev) {
    usersPrev.addEventListener("click", () => {
      if (usersPage > 1) {
        usersPage -= 1;
        renderUsers();
      }
    });
  }
  if (usersNext) {
    usersNext.addEventListener("click", () => {
      usersPage += 1;
      renderUsers();
    });
  }

  window.addEventListener("keydown", (e) => {
    const target = e.target;
    const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
    const isTypingField =
      tag === "input" || tag === "textarea" || target.isContentEditable;

    // Ctrl+K: foco en búsqueda global
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const globalInput = document.getElementById("global-search-input");
      if (globalInput) {
        globalInput.focus();
        globalInput.select();
      }
      return;
    }

    if (isTypingField) return;

    // Alt+1..9: cambio rápido de vista
    if (e.altKey && !e.ctrlKey && !e.shiftKey) {
      switch (e.key) {
        case "1":
          setAdminView("dashboard");
          break;
        case "2":
          setAdminView("logs");
          break;
        case "3":
          setAdminView("system-log");
          break;
        case "4":
          setAdminView("general");
          break;
        case "5":
          setAdminView("management");
          break;
        case "6":
          setAdminView("users");
          break;
        case "7":
          setAdminView("stations");
          break;
        case "8":
          setAdminView("tv");
          break;
        case "9":
          setAdminView("profile");
          break;
        default:
          return;
      }
    }

    // / abre búsqueda en bitácora cuando esté visible
    if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === "/") {
      const logsView = document.getElementById("admin-view-logs");
      if (logsView && logsView.classList.contains("is-active")) {
        e.preventDefault();
        const logSearchInput = document.getElementById("log-search");
        if (logSearchInput) {
          logSearchInput.focus();
          logSearchInput.select();
        }
      }
    }
  });
}

function applySavedTheme() {
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY) || "light";
  const isDark = saved === "dark";
  document.body.classList.toggle("theme-dark", isDark);

  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.innerHTML = isDark ? "&#9790;" : "&#9728;";
  }
}

function setupThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("theme-dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, isDark ? "dark" : "light");
    btn.innerHTML = isDark ? "&#9790;" : "&#9728;";
  });
}

function hydrateLogStationSelect() {
  const select = document.getElementById("log-station");
  if (!select) return;
  select.innerHTML = "";
  let stationsSource = [...adminState.stations];
  const isStationScoped =
    currentUser && currentUser.role === "jefe_estacion";
  if (isStationScoped && assignedStationId) {
    stationsSource = stationsSource.filter((s) => s.id === assignedStationId);
  }

  stationsSource.forEach((st) => {
    const opt = document.createElement("option");
    opt.value = st.id;
    opt.textContent = st.name;
    select.appendChild(opt);
  });
}

function hydrateDashboardStationSelect() {
  const select = document.getElementById("dashboard-station-select");
  if (!select) return;

  select.innerHTML = "";

  let stationsSource = [...adminState.stations];
  const role = currentUser && currentUser.role;
  const isStationScoped = role === "jefe_estacion";
  if (isStationScoped && assignedStationId) {
    stationsSource = stationsSource.filter((s) => s.id === assignedStationId);
  }

  stationsSource.forEach((st) => {
    const opt = document.createElement("option");
    opt.value = st.id;
    opt.textContent = st.name;
    select.appendChild(opt);
  });

  let initialId = dashboardStationId;
  if (!initialId) {
    if (isStationScoped && assignedStationId) {
      initialId = assignedStationId;
    } else if (stationsSource[0]) {
      initialId = stationsSource[0].id;
    }
  }

  dashboardStationId = initialId || "";
  if (initialId) {
    select.value = initialId;
  }

  // Jefe de estación no puede cambiar de estación en el panel
  if (isStationScoped) {
    select.disabled = true;
  } else {
    select.disabled = false;
  }

  select.onchange = function () {
    dashboardStationId = select.value || "";
    renderDashboard();
  };
}

function hydrateShiftStationSelect() {
  const select = document.getElementById("shift-station");
  if (!select) return;

  select.innerHTML = "";

  let stationsSource = [...adminState.stations];
  const isStationScoped = currentUser && currentUser.role === "jefe_estacion";
  if (isStationScoped && assignedStationId) {
    stationsSource = stationsSource.filter((s) => s.id === assignedStationId);
  }

  stationsSource.forEach((st) => {
    const opt = document.createElement("option");
    opt.value = st.id;
    opt.textContent = st.name;
    select.appendChild(opt);
  });
}

function hydrateLogFilterStationSelect() {
  const select = document.getElementById("log-filter-station");
  if (!select) return;

  select.innerHTML = "";

  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "Todas";
  select.appendChild(defaultOpt);

  let stationsSource = [...adminState.stations];
  const isStationScoped = currentUser && currentUser.role === "jefe_estacion";
  if (isStationScoped && assignedStationId) {
    stationsSource = stationsSource.filter((s) => s.id === assignedStationId);
  }

  stationsSource.forEach((st) => {
    const opt = document.createElement("option");
    opt.value = st.id;
    opt.textContent = st.name;
    select.appendChild(opt);
  });
}

function hydrateReportStationSelect() {
  const select = document.getElementById("report-station");
  if (!select) return;

  select.innerHTML = "";

  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "Todas";
  select.appendChild(defaultOpt);

  let stationsSource = [...adminState.stations];
  const isStationScoped = currentUser && currentUser.role === "jefe_estacion";
  if (isStationScoped && assignedStationId) {
    stationsSource = stationsSource.filter((s) => s.id === assignedStationId);
  }

  stationsSource.forEach((st) => {
    const opt = document.createElement("option");
    opt.value = st.id;
    opt.textContent = st.name;
    select.appendChild(opt);
  });
}

function renderMonthlyReport() {
  const stationSelect = document.getElementById("report-station");
  const monthInput = document.getElementById("report-month");
  const tbody = document.querySelector("#report-table tbody");
  const areaTbody = document.querySelector("#report-area-table tbody");
  const incidentTypeTbody = document.querySelector(
    "#report-incidenttype-table tbody"
  );
  const stationRankTbody = document.querySelector(
    "#report-stationrank-table tbody"
  );
  const shiftTbody = document.querySelector("#report-shift-table tbody");
  const fuelTbody = document.querySelector("#report-fuel-table tbody");
  const fuelTypeTbody = document.querySelector(
    "#report-fueltype-table tbody"
  );

  if (!tbody) return;

  const fuelTypeSelect = document.getElementById("report-fueltype");

  hydrateReportStationSelect();

  const stationIdFilter = stationSelect ? stationSelect.value : "";
  const monthValue = monthInput && monthInput.value ? monthInput.value : "";
  const fuelTypeFilter = fuelTypeSelect ? fuelTypeSelect.value : "";

  const year = monthValue ? monthValue.split("-")[0] : "";
  const month = monthValue ? monthValue.split("-")[1] : "";

  // Guardar filtros de reporte mensual
  try {
    const filters = {
      stationId: stationIdFilter,
      month: monthValue,
      fuelType: fuelTypeFilter,
    };
    window.localStorage.setItem(REPORT_FILTERS_KEY, JSON.stringify(filters));
  } catch (e) {
    // silencioso
  }

  const isStationScoped = currentUser && currentUser.role === "jefe_estacion";

  let total = 0;
  let okCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  let incidentsCount = 0;
  let incidentsLow = 0;
  let incidentsMedium = 0;
  let incidentsHigh = 0;
  let fuelDeliveriesCount = 0;
  let fuelLitersTotal = 0;

  const areaStats = {};
  const incidentTypeStats = {};
  const stationIncidentStats = {};
  const shiftStats = {};

  tbody.innerHTML = "";
  if (areaTbody) areaTbody.innerHTML = "";
  if (incidentTypeTbody) incidentTypeTbody.innerHTML = "";
  if (stationRankTbody) stationRankTbody.innerHTML = "";
  if (shiftTbody) shiftTbody.innerHTML = "";
  if (fuelTbody) fuelTbody.innerHTML = "";
  if (fuelTypeTbody) fuelTypeTbody.innerHTML = "";

  const fuelRows = [];
  const fuelTypeStats = {};

  // Colección auxiliar para exportar el reporte a CSV
  const exportRows = [];

  adminState.logs.forEach((log) => {
    if (isStationScoped && assignedStationId && log.stationId !== assignedStationId) {
      return;
    }
    if (stationIdFilter && log.stationId !== stationIdFilter) return;
    if (monthValue && log.date) {
      const [y, m] = log.date.split("-");
      if (y !== year || m !== month) return;
    }

    total += 1;
    if (log.status === "ok") okCount += 1;
    else if (log.status === "warning") warningCount += 1;
    else if (log.status === "error") errorCount += 1;

    if (log.status === "warning" || log.status === "error") {
      incidentsCount += 1;
      const sev = (log.severity || "").toLowerCase();
      if (sev === "baja") incidentsLow += 1;
      else if (sev === "media") incidentsMedium += 1;
      else if (sev === "alta") incidentsHigh += 1;

      const typeKey = (log.incidentType || "Sin tipo").toLowerCase();
      if (!incidentTypeStats[typeKey]) {
        incidentTypeStats[typeKey] = 0;
      }
      incidentTypeStats[typeKey] += 1;

      const stKey = log.stationId || "sin-estacion";
      if (!stationIncidentStats[stKey]) {
        stationIncidentStats[stKey] = 0;
      }
      stationIncidentStats[stKey] += 1;
    }

    const isFuelDelivery =
      (log.incidentType || "") === "Recepción de pipa" ||
      (log.entry && String(log.entry).indexOf("Recepción de pipa") !== -1);
    if (isFuelDelivery) {
      const typeLabelRaw = (log.fuelType || "").toString().toLowerCase();
      if (fuelTypeFilter) {
        let matchesFuel = false;
        if (fuelTypeFilter === "magna") {
          matchesFuel =
            typeLabelRaw.indexOf("magna") !== -1 ||
            typeLabelRaw.indexOf("verde") !== -1;
        } else if (fuelTypeFilter === "premium") {
          matchesFuel =
            typeLabelRaw.indexOf("premium") !== -1 ||
            typeLabelRaw.indexOf("roja") !== -1;
        } else if (fuelTypeFilter === "diesel") {
          matchesFuel =
            typeLabelRaw.indexOf("diésel") !== -1 ||
            typeLabelRaw.indexOf("diesel") !== -1;
        } else if (fuelTypeFilter === "otro") {
          matchesFuel =
            !typeLabelRaw ||
            (typeLabelRaw.indexOf("magna") === -1 &&
              typeLabelRaw.indexOf("verde") === -1 &&
              typeLabelRaw.indexOf("premium") === -1 &&
              typeLabelRaw.indexOf("roja") === -1 &&
              typeLabelRaw.indexOf("diésel") === -1 &&
              typeLabelRaw.indexOf("diesel") === -1);
        }

        if (!matchesFuel) {
          return;
        }
      }

      fuelDeliveriesCount += 1;
      if (typeof log.fuelLiters === "number" && !isNaN(log.fuelLiters)) {
        fuelLitersTotal += log.fuelLiters;
      }

      const stationForLog = adminState.stations.find(
        (s) => s.id === log.stationId
      );
      const fuelTypeLabel = (log.fuelType || "Otro").toString();
      if (!fuelTypeStats[fuelTypeLabel]) {
        fuelTypeStats[fuelTypeLabel] = 0;
      }
      if (typeof log.fuelLiters === "number" && !isNaN(log.fuelLiters)) {
        fuelTypeStats[fuelTypeLabel] += log.fuelLiters;
      }

      fuelRows.push({
        id: log.id,
        date: log.date || "",
        time: log.time || "",
        stationName: stationForLog ? stationForLog.name : "",
        user: log.user || "",
        fuelType: log.fuelType || "",
        fuelLiters:
          typeof log.fuelLiters === "number" && !isNaN(log.fuelLiters)
            ? log.fuelLiters
            : null,
        evidenceUrl: log.evidenceUrl || log.manualUrl || "",
      });
    }

    // Agrupar por área usando el catálogo de usuarios
    let area = "Sin área";
    if (log.user) {
      const userRecord = adminState.users.find((u) => u.name === log.user);
      if (userRecord && userRecord.area) {
        area = userRecord.area;
      }
    }

    if (!areaStats[area]) {
      areaStats[area] = {
        total: 0,
        ok: 0,
        warning: 0,
        error: 0,
        incidents: 0,
      };
    }
    const stats = areaStats[area];
    stats.total += 1;
    if (log.status === "ok") stats.ok += 1;
    if (log.status === "warning") stats.warning += 1;
    if (log.status === "error") stats.error += 1;
    if (log.status === "warning" || log.status === "error") {
      stats.incidents += 1;
    }

    const shiftKey = log.shift || "Sin turno";
    if (!shiftStats[shiftKey]) {
      shiftStats[shiftKey] = {
        total: 0,
        ok: 0,
        warning: 0,
        error: 0,
        incidents: 0,
      };
    }
    const sStats = shiftStats[shiftKey];
    sStats.total += 1;
    if (log.status === "ok") sStats.ok += 1;
    if (log.status === "warning") sStats.warning += 1;
    if (log.status === "error") sStats.error += 1;
    if (log.status === "warning" || log.status === "error") {
      sStats.incidents += 1;
    }

    const tr = document.createElement("tr");
    const station = adminState.stations.find((s) => s.id === log.stationId);

    const formattedDate = formatDateShort(log.date || "");
    const cells = [
      formattedDate,
      log.time || "",
      station ? station.name : "",
      log.user || "",
      log.description || "",
      log.evidenceUrl || "",
      log.status || "",
    ];

    // Guardar fila plana para exportación CSV del reporte mensual
    exportRows.push({
      date: formattedDate,
      time: log.time || "",
      station: station ? station.name : "",
      user: log.user || "",
      description: log.description || "",
      status: log.status || "",
    });

    cells.forEach((value, idx) => {
      const td = document.createElement("td");

      // Columna Evidencia (índice 5): enlace si es URL
      if (idx === 5) {
        const text = (value || "").toString();
        if (text) {
          if (/^https?:\/\//i.test(text)) {
            const a = document.createElement("a");
            a.href = text;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = "Abrir";
            td.appendChild(a);
          } else {
            td.textContent = text;
          }
        } else {
          td.textContent = "";
        }
      }
      // Columna Estado (última, índice 6): usar badge de estado OK/Advertencia/Error
      else if (idx === 6) {
        const statusText = (value || "").toString().toLowerCase();
        if (statusText) {
          const span = document.createElement("span");
          span.className = "badge-status";
          if (statusText === "ok") {
            span.classList.add("badge-status-ok");
            span.textContent = "OK";
          } else if (statusText === "warning") {
            span.classList.add("badge-status-warning");
            span.textContent = "Advertencia";
          } else if (statusText === "error") {
            span.classList.add("badge-status-error");
            span.textContent = "Error";
          } else {
            span.textContent = value || "";
          }
          td.appendChild(span);
        } else {
          td.textContent = "";
        }
      } else {
        td.textContent = value;
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  const totalEl = document.getElementById("report-total-logs");
  const okEl = document.getElementById("report-ok");
  const warnEl = document.getElementById("report-warning");
  const errEl = document.getElementById("report-error");
  const incEl = document.getElementById("report-incidents");
  const incLowEl = document.getElementById("report-incidents-low");
  const incMedEl = document.getElementById("report-incidents-medium");
  const incHighEl = document.getElementById("report-incidents-high");
  const trendEl = document.getElementById("report-trend-text");
  const fuelCountEl = document.getElementById("report-fuel-deliveries");
  const fuelLitersEl = document.getElementById("report-fuel-liters");

  if (totalEl) totalEl.textContent = String(total);
  if (okEl) okEl.textContent = String(okCount);
  if (warnEl) warnEl.textContent = String(warningCount);
  if (errEl) errEl.textContent = String(errorCount);
  if (incEl) incEl.textContent = String(incidentsCount);
  if (incLowEl) incLowEl.textContent = String(incidentsLow);
  if (incMedEl) incMedEl.textContent = String(incidentsMedium);
  if (incHighEl) incHighEl.textContent = String(incidentsHigh);
  if (fuelCountEl) fuelCountEl.textContent = String(fuelDeliveriesCount);
  if (fuelLitersEl)
    fuelLitersEl.textContent =
      fuelLitersTotal > 0
        ? `${fuelLitersTotal.toLocaleString("es-MX")} L`
        : "0 L";

  if (fuelTbody) {
    if (!fuelRows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "admin-empty-row";
      td.innerHTML = monthValue
        ? '<span class="admin-empty-row-icon">⛽</span><span class="admin-empty-row-text">Sin recepciones de pipa para el mes seleccionado.</span>'
        : '<span class="admin-empty-row-icon">📅</span><span class="admin-empty-row-text">Selecciona un mes para ver las recepciones de pipa.</span>';
      tr.appendChild(td);
      fuelTbody.appendChild(tr);
    } else {
      fuelRows
        .sort((a, b) => {
          const aKey = (a.date || "") + "T" + (a.time || "");
          const bKey = (b.date || "") + "T" + (b.time || "");
          if (aKey < bKey) return -1;
          if (aKey > bKey) return 1;
          return 0;
        })
        .forEach((row) => {
          const tr = document.createElement("tr");

          const cells = [
            formatDateShort(row.date || ""),
            row.time || "",
            row.stationName || "",
            row.user || "",
          ];

          cells.forEach((value) => {
            const td = document.createElement("td");
            td.textContent = value;
            tr.appendChild(td);
          });

          // Columna de tipo de combustible con colores
          const fuelTd = document.createElement("td");
          const fuelSpan = document.createElement("span");
          const fuelType = (row.fuelType || "").toString();
          fuelSpan.className = "badge-fuel";
          const lower = fuelType.toLowerCase();
          if (lower.indexOf("magna") !== -1 || lower.indexOf("verde") !== -1) {
            fuelSpan.classList.add("badge-fuel-magna");
          } else if (
            lower.indexOf("premium") !== -1 ||
            lower.indexOf("roja") !== -1
          ) {
            fuelSpan.classList.add("badge-fuel-premium");
          } else if (lower.indexOf("diésel") !== -1 || lower.indexOf("diesel") !== -1) {
            const fuelTypeSelect = document.getElementById("report-fueltype");
            fuelSpan.classList.add("badge-fuel-diesel");
          }
          fuelSpan.textContent = fuelType || "";
          fuelTd.appendChild(fuelSpan);
          tr.appendChild(fuelTd);
              if (fuelTypeSelect && f.fuelType) fuelTypeSelect.value = f.fuelType;

          // Columna de litros
          const litersTd = document.createElement("td");
          litersTd.textContent =
            row.fuelLiters != null
              ? row.fuelLiters.toLocaleString("es-MX")
              : "";
          tr.appendChild(litersTd);

          const evidenceTd = document.createElement("td");
          const url = row.evidenceUrl || "";
          if (url) {
            if (/^https?:\/\//i.test(url)) {
              const a = document.createElement("a");
              a.href = url;
              a.target = "_blank";
              a.rel = "noopener noreferrer";
              a.textContent = "Abrir";
              evidenceTd.appendChild(a);
            } else {
              evidenceTd.textContent = url;
            }
          } else {
            evidenceTd.textContent = "";
          }
          tr.appendChild(evidenceTd);

          // Columna de estado de revisión / aprobación específica para pipas
          const reviewTd = document.createElement("td");
          const select = document.createElement("select");
          select.className = "admin-select-inline";
          const currentLog = adminState.logs.find((l) => l.id === row.id);
          const currentStatus = (currentLog && currentLog.fuelReviewStatus) || "registrada";

          const options = [
            { value: "registrada", label: "Registrada" },
            { value: "revisada", label: "Revisada" },
            { value: "aprobada", label: "Aprobada" },
            { value: "rechazada", label: "Rechazada" },
          ];
          options.forEach((optCfg) => {
            const opt = document.createElement("option");
            opt.value = optCfg.value;
            opt.textContent = optCfg.label;
            if (optCfg.value === currentStatus) {
              opt.selected = true;
            }
            select.appendChild(opt);
          });

          select.addEventListener("change", () => {
            const log = adminState.logs.find((l) => l.id === row.id);
            if (!log) return;
            const prev = log.fuelReviewStatus || "registrada";
            const next = select.value || "registrada";
            log.fuelReviewStatus = next;
            log.fuelReviewUpdatedAt = new Date().toISOString();
            if (currentUser) {
              log.fuelReviewUpdatedBy = currentUser.name || "";
              log.fuelReviewUpdatedByRole = currentUser.role || "";
            }
            saveAdminState();
            try {
              addGeneralLogEntry(
                "Cambio en recepción de pipa",
                `El registro ${log.id} cambió de estado de revisión de "${prev}" a "${next}"`,
                "ok"
              );
            } catch (e) {
              // silencioso
            }
          });

          reviewTd.appendChild(select);
          tr.appendChild(reviewTd);

          fuelTbody.appendChild(tr);
        });
    }
  }

  if (fuelTypeTbody) {
    const entries = Object.entries(fuelTypeStats).filter(([, liters]) => liters > 0);
    if (!entries.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 2;
      td.className = "admin-empty-row";
      td.innerHTML = monthValue
        ? '<span class="admin-empty-row-icon">⛽</span><span class="admin-empty-row-text">Sin litros registrados por tipo de combustible en el mes seleccionado.</span>'
        : '<span class="admin-empty-row-icon">📅</span><span class="admin-empty-row-text">Selecciona un mes para ver litros por combustible.</span>';
      tr.appendChild(td);
      fuelTypeTbody.appendChild(tr);
    } else {
      entries
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, liters]) => {
          const tr = document.createElement("tr");
          const typeTd = document.createElement("td");
          const litersTd = document.createElement("td");

          const span = document.createElement("span");
          span.className = "badge-fuel";
          const lower = type.toLowerCase();
          if (lower.indexOf("magna") !== -1 || lower.indexOf("verde") !== -1) {
            span.classList.add("badge-fuel-magna");
          } else if (
            lower.indexOf("premium") !== -1 ||
            lower.indexOf("roja") !== -1
          ) {
            span.classList.add("badge-fuel-premium");
          } else if (lower.indexOf("diésel") !== -1 || lower.indexOf("diesel") !== -1) {
            span.classList.add("badge-fuel-diesel");
          }
          span.textContent = type;
          typeTd.appendChild(span);

          litersTd.textContent = liters.toLocaleString("es-MX");
          tr.appendChild(typeTd);
          tr.appendChild(litersTd);
          fuelTypeTbody.appendChild(tr);
        });
    }
  }

  // Gráfica mensual de litros por tipo de combustible
  if (typeof Chart !== "undefined") {
    const fuelMonthCtx = document.getElementById("chart-fuel-month");
    if (fuelMonthCtx) {
      const fuelEntries = Object.entries(fuelTypeStats).filter(([, liters]) =>
        typeof liters === "number" && liters > 0
      );

      const fuelMonthSummaryEl = document.getElementById(
        "chart-fuel-month-summary"
      );

      if (!fuelEntries.length) {
        if (fuelTypeMonthChart) {
          fuelTypeMonthChart.destroy();
          fuelTypeMonthChart = null;
        }

        if (fuelMonthSummaryEl) {
          fuelMonthSummaryEl.textContent =
            monthValue
              ? "Sin litros registrados por tipo de combustible en el mes seleccionado."
              : "Selecciona un mes para ver la distribución de litros por tipo de combustible.";
        }
      } else {
        // Ordenar por litros descendente
        fuelEntries.sort((a, b) => b[1] - a[1]);
        const labels = fuelEntries.map(([type]) => type);
        const data = fuelEntries.map(([, liters]) => liters);
        const colors = labels.map((type) => getFuelColorForType(type));

        const isDark =
          document.body &&
          document.body.classList &&
          document.body.classList.contains("theme-dark");
        const axisColor = isDark ? "#e5e7eb" : "#374151";

        const chartData = {
          labels,
          datasets: [
            {
              data,
              backgroundColor: colors,
              borderColor: colors,
              borderWidth: 2,
            },
          ],
        };

        if (fuelMonthSummaryEl) {
          const totalLiters = data.reduce(function (sum, v) {
            return sum + (typeof v === "number" ? v : 0);
          }, 0);
          const topType = labels[0];
          const topLiters = data[0] || 0;
          const pct = totalLiters
            ? ((topLiters / totalLiters) * 100).toFixed(1)
            : "0.0";
          fuelMonthSummaryEl.textContent =
            "En el mes seleccionado, el combustible principal es " +
            topType +
            " con " +
            topLiters.toLocaleString("es-MX") +
            " L (" +
            pct +
            "% del total).";
        }

        if (fuelTypeMonthChart) {
          fuelTypeMonthChart.data = chartData;
          fuelTypeMonthChart.update();
        } else {
          fuelTypeMonthChart = new Chart(fuelMonthCtx, {
            type: "doughnut",
            data: chartData,
            options: {
              responsive: true,
              maintainAspectRatio: false,
              animation: {
                duration: 900,
                easing: "easeOutQuart",
              },
              plugins: {
                legend: {
                  position: "bottom",
                  labels: {
                    boxWidth: 10,
                    font: { size: 10 },
                    color: axisColor,
                  },
                },
                tooltip: {
                  callbacks: {
                    label: function (context) {
                      const label = context.label || "";
                      const value =
                        typeof context.parsed === "number"
                          ? context.parsed
                          : 0;
                      const dataArr =
                        (context.chart &&
                          context.chart.data &&
                          context.chart.data.datasets &&
                          context.chart.data.datasets[0] &&
                          context.chart.data.datasets[0].data) || [];
                      const total = dataArr.reduce(function (sum, v) {
                        return sum + (typeof v === "number" ? v : 0);
                      }, 0);
                      const pct = total
                        ? ((value / total) * 100).toFixed(1)
                        : "0.0";
                      return (
                        label +
                        ": " +
                        value.toLocaleString("es-MX") +
                        " L (" +
                        pct +
                        "%)"
                      );
                    },
                  },
                },
                dashboardDoughnutCenter: {
                  label: "Litros mes",
                  color: axisColor,
                  fontSize: 15,
                },
              },
              cutout: "65%",
            },
            plugins: [dashboardDoughnutCenter],
          });
        }
      }
    }
  }

  if (areaTbody) {
    Object.keys(areaStats).forEach((area) => {
      const stats = areaStats[area];
      const tr = document.createElement("tr");
      const cells = [
        area,
        String(stats.total),
        String(stats.incidents),
        String(stats.ok),
        String(stats.warning),
        String(stats.error),
      ];
      cells.forEach((value) => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      areaTbody.appendChild(tr);
    });
  }

  if (incidentTypeTbody) {
    const entries = Object.entries(incidentTypeStats).sort(
      (a, b) => b[1] - a[1]
    );

    if (!entries.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 2;
        td.className = "admin-empty-row";
        td.innerHTML = monthValue
          ? '<span class="admin-empty-row-icon">📊</span><span class="admin-empty-row-text">Sin incidentes registrados para el mes seleccionado.</span>'
          : '<span class="admin-empty-row-icon">📅</span><span class="admin-empty-row-text">Selecciona un mes para ver los tipos de incidente.</span>';
      tr.appendChild(td);
      incidentTypeTbody.appendChild(tr);
    } else {
      entries.slice(0, 5).forEach(([type, count]) => {
        const tr = document.createElement("tr");
        const typeTd = document.createElement("td");
        const countTd = document.createElement("td");
        typeTd.textContent = type;
        countTd.textContent = String(count);
        tr.appendChild(typeTd);
        tr.appendChild(countTd);
        incidentTypeTbody.appendChild(tr);
      });
    }
  }

  if (stationRankTbody) {
    const entries = Object.entries(stationIncidentStats).sort(
      (a, b) => b[1] - a[1]
    );

    if (!entries.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 2;
      td.className = "admin-empty-row";
      td.innerHTML = monthValue
        ? '<span class="admin-empty-row-icon">⛽</span><span class="admin-empty-row-text">Sin incidentes registrados para el mes seleccionado.</span>'
        : '<span class="admin-empty-row-icon">📅</span><span class="admin-empty-row-text">Selecciona un mes para ver el ranking de estaciones.</span>';
      tr.appendChild(td);
      stationRankTbody.appendChild(tr);
    } else {
      entries.slice(0, 5).forEach(([stationIdKey, count]) => {
        const tr = document.createElement("tr");
        const nameTd = document.createElement("td");
        const countTd = document.createElement("td");
        const st = adminState.stations.find((s) => s.id === stationIdKey);
        nameTd.textContent = st ? st.name : "Sin estación";
        countTd.textContent = String(count);
        tr.appendChild(nameTd);
        tr.appendChild(countTd);
        stationRankTbody.appendChild(tr);
      });
    }
  }

    if (shiftTbody) {
      const entries = Object.entries(shiftStats);
      if (!entries.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 6;
        td.className = "admin-empty-row";
        td.innerHTML = monthValue
          ? '<span class="admin-empty-row-icon">🕒</span><span class="admin-empty-row-text">Sin registros para el mes seleccionado.</span>'
          : '<span class="admin-empty-row-icon">📅</span><span class="admin-empty-row-text">Selecciona un mes para ver el resumen por turno.</span>';
        tr.appendChild(td);
        shiftTbody.appendChild(tr);
      } else {
        entries.forEach(([shiftKey, stats]) => {
          const tr = document.createElement("tr");
          const cells = [
            shiftKey,
            String(stats.total),
            String(stats.incidents),
            String(stats.ok),
            String(stats.warning),
            String(stats.error),
          ];
          cells.forEach((value) => {
            const td = document.createElement("td");
            td.textContent = value;
            tr.appendChild(td);
          });
          shiftTbody.appendChild(tr);
        });
      }
    }

  if (trendEl) {
    if (!monthValue) {
      trendEl.textContent =
        "Selecciona un mes para ver la comparación de incidentes frente al mes anterior.";
    } else {
      const mNum = Number(month);
      const yNum = Number(year);
      let prevYear = yNum;
      let prevMonth = mNum - 1;
      if (!mNum || !yNum) {
        trendEl.textContent = "";
      } else {
        if (prevMonth === 0) {
          prevMonth = 12;
          prevYear = yNum - 1;
        }

        let prevIncidents = 0;
        adminState.logs.forEach((log) => {
          if (isStationScoped && assignedStationId && log.stationId !== assignedStationId) {
            return;
          }
          if (stationIdFilter && log.stationId !== stationIdFilter) return;
          if (!log.date) return;
          const [y, m] = log.date.split("-");
          const yy = Number(y);
          const mm = Number(m);
          if (yy !== prevYear || mm !== prevMonth) return;
          if (log.status === "warning" || log.status === "error") {
            prevIncidents += 1;
          }
        });

        const diff = incidentsCount - prevIncidents;
        const diffLabel =
          diff === 0 ? "sin cambio" : diff > 0 ? `+${diff}` : String(diff);
        trendEl.textContent = `Incidentes mes anterior: ${prevIncidents} (${diffLabel} frente al mes seleccionado).`;
      }
    }
  }

  // Guardar en memoria las filas del reporte para exportación CSV
  window.__cogMonthlyReportExport = {
    filters: {
      stationId: stationIdFilter,
      month: monthValue,
      fuelType: fuelTypeFilter,
    },
    rows: exportRows,
    fuelRows,
    fuelTypeStats,
    totals: {
      total,
      okCount,
      warningCount,
      errorCount,
      incidentsCount,
      incidentsLow,
      incidentsMedium,
      incidentsHigh,
      fuelDeliveriesCount,
      fuelLitersTotal,
    },
  };
}

function exportMonthlyReportCsv() {
  try {
    const snapshot = window.__cogMonthlyReportExport;
    if (!snapshot || !Array.isArray(snapshot.rows)) {
      showToast(
        "Genera primero el reporte mensual antes de exportar.",
        "warning"
      );
      return;
    }

    const { filters, rows, fuelRows, fuelTypeStats, totals } = snapshot;

    if (!rows.length && (!fuelRows || !fuelRows.length)) {
      showToast(
        "No hay datos en el reporte mensual para exportar.",
        "warning"
      );
      return;
    }

    const lines = [];

    // Encabezado con filtros aplicados
    const stationSelect = document.getElementById("report-station");
    const stationName =
      stationSelect && stationSelect.value
        ? (stationSelect.options[stationSelect.selectedIndex] || {}).text || ""
        : "Todas";

    lines.push("Reporte mensual COG Work Log");
    lines.push(
      `Estacion: "${stationName}", Mes: "${(filters && filters.month) ||
        ""}", Combustible (pipas): "${(filters && filters.fuelType) || "Todos"}"`
    );
    lines.push("");

    // Resumen de totales
    if (totals) {
      lines.push("Resumen general");
      lines.push(
        "Total registros,OK,Advertencia,Error,Incidentes,Incidentes baja,Incidentes media,Incidentes alta,Recepciones pipa,Litros recibidos"
      );
      lines.push(
        [
          totals.total,
          totals.okCount,
          totals.warningCount,
          totals.errorCount,
          totals.incidentsCount,
          totals.incidentsLow,
          totals.incidentsMedium,
          totals.incidentsHigh,
          totals.fuelDeliveriesCount,
          totals.fuelLitersTotal,
        ].join(",")
      );
      lines.push("");
    }

    // Detalle de registros del mes
    if (rows.length) {
      lines.push("Detalle de registros del mes");
      lines.push("Fecha,Hora,Estacion,Usuario,Descripcion,Estado");
      rows.forEach((r) => {
        const cols = [
          r.date,
          r.time,
          r.station,
          r.user,
          (r.description || "").replace(/"/g, "'"),
          r.status,
        ];
        lines.push(cols.map((v) => `"${v != null ? String(v) : ""}"`).join(","));
      });
      lines.push("");
    }

    // Detalle de recepciones de pipa del mes
    if (fuelRows && fuelRows.length) {
      lines.push("Recepciones de pipa del mes");
      lines.push("Fecha,Hora,Estacion,Usuario,Combustible,Litros");
      fuelRows.forEach((r) => {
        const cols = [
          formatDateShort(r.date || ""),
          r.time || "",
          r.stationName || "",
          r.user || "",
          r.fuelType || "",
          r.fuelLiters != null ? r.fuelLiters : "",
        ];
        lines.push(cols.map((v) => `"${v != null ? String(v) : ""}"`).join(","));
      });
      lines.push("");
    }

    // Resumen de litros por tipo de combustible
    if (fuelTypeStats && Object.keys(fuelTypeStats).length) {
      lines.push("Litros por tipo de combustible");
      lines.push("Combustible,Litros");
      Object.entries(fuelTypeStats).forEach(([type, liters]) => {
        if (!liters) return;
        lines.push(
          [
            `"${type}"`,
            typeof liters === "number" ? liters : String(liters || ""),
          ].join(",")
        );
      });
      lines.push("");
    }

    const csvContent = lines.join("\r\n");
    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    a.href = url;
    a.download = `cog-work-log-reporte-mensual-${y}${m}${d}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast("Reporte mensual exportado a CSV.", "success");
  } catch (e) {
    console.error("Error al exportar reporte mensual", e);
    showToast("No se pudo exportar el reporte mensual.", "error");
  }
}

function performGlobalSearch() {
  const input = document.getElementById("global-search-input");
  if (!input) return;

  const query = input.value.trim().toLowerCase();
  if (!query) {
    return;
  }

  // Priorizar búsqueda en registros de bitácora
  const logSearch = document.getElementById("log-search");
  if (logSearch) {
    logSearch.value = query;
  }
  setAdminView("logs");
  renderLogs();

  // También ajustar búsquedas en general y estaciones para cuando el usuario cambie de vista
  const generalSearch = document.getElementById("general-search");
  if (generalSearch) {
    generalSearch.value = query;
  }
  const stationSearch = document.getElementById("station-search");
  if (stationSearch) {
    stationSearch.value = query;
  }
}

function hydrateUserStationSelect() {
  const select = document.getElementById("user-station");
  if (!select) return;

  select.innerHTML = "";

  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "Sin estación";
  select.appendChild(defaultOpt);

  adminState.stations.forEach((st) => {
    const opt = document.createElement("option");
    opt.value = st.id;
    opt.textContent = st.name;
    select.appendChild(opt);
  });
}

function getCurrentAdminUserRecord() {
  if (!currentUser) return null;

  const raw = window.localStorage.getItem(ADMIN_STORAGE_KEY);
  let users = adminState.users;
  try {
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.users)) {
        users = parsed.users;
      }
    }
  } catch (e) {
    console.warn("No se pudo leer usuarios de administración para perfil", e);
  }

  const username =
    (currentUser && currentUser.username) ||
    window.localStorage.getItem(`${AUTH_KEY}-username`) ||
    "";

  let user = null;
  if (username) {
    user = users.find((u) => u.username === username) || null;
  }
  if (!user) {
    user =
      users.find(
        (u) => u.name === currentUser.name && u.role === currentUser.role
      ) || null;
  }

  return user;
}

function getLastLoginForCurrentUser() {
  if (!currentUser || !Array.isArray(adminState.generalLogs)) return null;

  const targetName = currentUser.name || "";
  let last = null;

  for (let i = adminState.generalLogs.length - 1; i >= 0; i -= 1) {
    const log = adminState.generalLogs[i];
    if (!log) continue;
    if (log.activity !== "Inicio de sesión") continue;
    if (log.user !== targetName) continue;
    last = log;
    break;
  }

  return last;
}

function getInitialsForName(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

function renderProfileView() {
  if (!currentUser) return;

  const userRecord = getCurrentAdminUserRecord();

  const avatarEl = document.getElementById("profile-avatar");
  const headerNameEl = document.getElementById("profile-header-name");
  const headerRoleEl = document.getElementById("profile-header-role");
  const headerStationEl = document.getElementById("profile-header-station");
  const headerLastLoginEl = document.getElementById("profile-last-login");

  const fullNameInput = document.getElementById("profile-fullname");
  const usernameInput = document.getElementById("profile-username");
  const roleInput = document.getElementById("profile-role");
  const areaInput = document.getElementById("profile-area");
  const positionInput = document.getElementById("profile-position");
  const rfcInput = document.getElementById("profile-rfc");
  const stationRfcInput = document.getElementById("profile-station-rfc");
  const emailInput = document.getElementById("profile-email");
  const phoneInput = document.getElementById("profile-phone");
  const photoInput = document.getElementById("profile-photo");

  const displayName = userRecord && userRecord.name ? userRecord.name : currentUser.name;

  const stationId = userRecord && userRecord.stationId ? userRecord.stationId : currentUser.stationId;
  const station = adminState.stations.find((s) => s.id === stationId);

  let roleLabel = "Operador";
  if (currentUser.role === "admin") roleLabel = "Administrador";
  else if (currentUser.role === "jefe_estacion") roleLabel = "Jefe de estación";
  else if (currentUser.role === "auditor") roleLabel = "Auditor";

  if (avatarEl) {
    const initials = getInitialsForName(displayName || "U");
    avatarEl.textContent = initials;
    avatarEl.style.backgroundImage = "";
    if (userRecord && userRecord.photoUrl) {
      avatarEl.style.backgroundImage = `url(${userRecord.photoUrl})`;
      avatarEl.style.backgroundSize = "cover";
      avatarEl.style.backgroundPosition = "center";
      avatarEl.textContent = "";
    }
  }

  if (headerNameEl) headerNameEl.textContent = displayName;
  if (headerRoleEl) headerRoleEl.textContent = roleLabel;
  if (headerStationEl) {
    const stationLabel = station ? station.name : "-";
    headerStationEl.textContent = `Estación asignada: ${stationLabel}`;
  }

   if (headerLastLoginEl) {
     const last = getLastLoginForCurrentUser();
     if (last && last.date && last.time) {
       headerLastLoginEl.textContent = `Último acceso: ${formatDateShort(
         last.date
       )} ${last.time}`;
     } else if (last && last.date) {
       headerLastLoginEl.textContent = `Último acceso: ${formatDateShort(
         last.date
       )}`;
     } else {
       headerLastLoginEl.textContent = "Último acceso: -";
     }
   }

  if (fullNameInput) fullNameInput.value = displayName || "";
  if (usernameInput)
    usernameInput.value = (userRecord && userRecord.username) || "";
  if (roleInput) roleInput.value = roleLabel;
  if (areaInput)
    areaInput.value =
      (userRecord && userRecord.area) || currentUser.area || "";
  if (positionInput)
    positionInput.value = (userRecord && userRecord.position) || "";
  if (rfcInput) rfcInput.value = (userRecord && userRecord.rfc) || "";
  if (stationRfcInput)
    stationRfcInput.value = (userRecord && userRecord.stationRfc) || "";
  if (emailInput) emailInput.value = (userRecord && userRecord.email) || "";
  if (phoneInput) phoneInput.value = (userRecord && userRecord.phone) || "";
  if (photoInput) photoInput.value = (userRecord && userRecord.photoUrl) || "";
}


function applySidebarByRole() {
  if (!currentUser) return;

  const items = document.querySelectorAll(".admin-sidebar-item");
  items.forEach((btn) => {
    const key = btn.getAttribute("data-view");
    let visible = true;

    if (currentUser.role === "jefe_estacion") {
      const allowed = ["dashboard", "logs", "stations", "profile"];
      visible = allowed.includes(key);
    } else if (currentUser.role === "auditor") {
      const allowed = ["dashboard", "logs", "alerts", "system-log", "general", "profile"];
      visible = allowed.includes(key);
    } else if (currentUser.role === "empleado") {
      const allowed = ["dashboard", "profile"];
      visible = allowed.includes(key);
    }

    btn.style.display = visible ? "" : "none";
  });
}

function updateDashboardCharts({ okCount, warningCount, errorCount, freqCounts, fuelTypeTodayStats }) {
  if (typeof Chart === "undefined") return;

  const statusCtx = document.getElementById("chart-status");
  const freqCtx = document.getElementById("chart-frequency");
  const fuelCtx = document.getElementById("chart-fuel-today");
  if (!statusCtx || !freqCtx) return;

  const isDark =
    document.body &&
    document.body.classList &&
    document.body.classList.contains("theme-dark");
  const axisColor = isDark ? "#e5e7eb" : "#374151";
  const gridColor = isDark
    ? "rgba(55, 65, 81, 0.7)"
    : "rgba(148, 163, 184, 0.25)";

  const statusData = {
    labels: ["OK", "Advertencia", "Error"],
    datasets: [
      {
        data: [okCount, warningCount, errorCount],
        backgroundColor: ["#22c55e", "#facc15", "#ef4444"],
        borderColor: ["#16a34a", "#eab308", "#dc2626"],
        borderWidth: 2,
      },
    ],
  };

  if (statusChart) {
    statusChart.data = statusData;
    statusChart.update();
  } else {
    statusChart = new Chart(statusCtx, {
      type: "doughnut",
      data: statusData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 900,
          easing: "easeOutQuart",
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              boxWidth: 10,
              font: { size: 10 },
              color: axisColor,
            },
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                const label = context.label || "";
                const value = typeof context.parsed === "number" ? context.parsed : 0;
                const dataArr =
                  (context.chart &&
                    context.chart.data &&
                    context.chart.data.datasets &&
                    context.chart.data.datasets[0] &&
                    context.chart.data.datasets[0].data) || [];
                const total = dataArr.reduce(function (sum, v) {
                  return sum + (typeof v === "number" ? v : 0);
                }, 0);
                const pct = total ? ((value / total) * 100).toFixed(1) : "0.0";
                return label + ": " + value + " (" + pct + "%)";
              },
            },
          },
          dashboardDoughnutCenter: {
            label: "Registros",
            color: axisColor,
            fontSize: 15,
          },
        },
        cutout: "65%",
      },
      plugins: [dashboardDoughnutCenter],
    });
  }

  const freqLabels = [
    "Única",
    "Diaria",
    "Semanal",
    "Mensual",
    "Bimestral",
    "Trimestral",
    "Anual",
  ];
  const freqKeys = [
    "unica",
    "diaria",
    "semanal",
    "mensual",
    "bimestral",
    "trimestral",
    "anual",
  ];
  const freqDataArr = freqKeys.map((key) => freqCounts[key] || 0);

  const freqData = {
    labels: freqLabels,
    datasets: [
      {
        data: freqDataArr,
        backgroundColor: [
          "#60a5fa",
          "#22c55e",
          "#a855f7",
          "#f97316",
          "#facc15",
          "#10b981",
          "#ef4444",
        ],
        borderWidth: 1,
        borderColor: "rgba(15,23,42,0.15)",
        borderRadius: 6,
        maxBarThickness: 28,
      },
    ],
  };

  if (frequencyChart) {
    frequencyChart.data = freqData;
    frequencyChart.update();
  } else {
    frequencyChart = new Chart(freqCtx, {
      type: "bar",
      data: freqData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (context) {
                const label = context.label || "";
                const value = typeof context.parsed.y === "number" ? context.parsed.y : context.parsed || 0;
                const dataArr =
                  (context.chart &&
                    context.chart.data &&
                    context.chart.data.datasets &&
                    context.chart.data.datasets[0] &&
                    context.chart.data.datasets[0].data) || [];
                const total = dataArr.reduce(function (sum, v) {
                  return sum + (typeof v === "number" ? v : 0);
                }, 0);
                const pct = total ? ((value / total) * 100).toFixed(1) : "0.0";
                return label + ": " + value + " (" + pct + "%)";
              },
            },
          },
        },
        scales: {
          x: {
            grid: {
              display: false,
            },
            ticks: {
              font: { size: 10 },
              color: axisColor,
            },
          },
          y: {
            beginAtZero: true,
            grid: {
              color: gridColor,
              drawBorder: false,
            },
            ticks: {
              stepSize: 1,
              precision: 0,
              font: { size: 10 },
              color: axisColor,
            },
          },
        },
      },
      plugins: [dashboardBarLabels],
    });
  }

  // Gráfica diaria de litros por tipo de combustible (solo si existe el canvas)
  if (fuelCtx) {
    const isDarkFuel =
      document.body &&
      document.body.classList &&
      document.body.classList.contains("theme-dark");
    const axisFuelColor = isDarkFuel ? "#e5e7eb" : "#374151";

    let entries = [];
    if (fuelTypeTodayStats && typeof fuelTypeTodayStats === "object") {
      entries = Object.entries(fuelTypeTodayStats).filter(([, liters]) =>
        typeof liters === "number" && liters > 0
      );
    }

    let fuelLabels;
    let fuelData;
    let fuelColors;

    const fuelSummaryEl = document.getElementById("chart-fuel-today-summary");

    if (!entries.length) {
      fuelLabels = ["Sin datos"];
      fuelData = [0];
      fuelColors = ["#9ca3af"];

      if (fuelSummaryEl) {
        fuelSummaryEl.textContent =
          "Sin litros registrados hoy para esta estación.";
      }
    } else {
      // Ordenar de mayor a menor litros
      entries.sort((a, b) => b[1] - a[1]);
      fuelLabels = entries.map(([type]) => type);
      fuelData = entries.map(([, liters]) => liters);
      fuelColors = fuelLabels.map((type) => getFuelColorForType(type));

      if (fuelSummaryEl) {
        const totalLiters = fuelData.reduce(function (sum, v) {
          return sum + (typeof v === "number" ? v : 0);
        }, 0);
        const topType = fuelLabels[0];
        const topLiters = fuelData[0] || 0;
        const pct = totalLiters
          ? ((topLiters / totalLiters) * 100).toFixed(1)
          : "0.0";
        fuelSummaryEl.textContent =
          "Hoy el combustible principal es " +
          topType +
          " con " +
          topLiters.toLocaleString("es-MX") +
          " L (" +
          pct +
          "% del total).";
      }
    }

    const fuelTodayData = {
      labels: fuelLabels,
      datasets: [
        {
          data: fuelData,
          backgroundColor: fuelColors,
          borderColor: fuelColors,
          borderWidth: 2,
        },
      ],
    };

    if (fuelTypeTodayChart) {
      fuelTypeTodayChart.data = fuelTodayData;
      fuelTypeTodayChart.update();
    } else {
      fuelTypeTodayChart = new Chart(fuelCtx, {
        type: "doughnut",
        data: fuelTodayData,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 900,
            easing: "easeOutQuart",
          },
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                boxWidth: 10,
                font: { size: 10 },
                color: axisFuelColor,
              },
            },
            tooltip: {
              callbacks: {
                label: function (context) {
                  const label = context.label || "";
                  const value =
                    typeof context.parsed === "number" ? context.parsed : 0;
                  const dataArr =
                    (context.chart &&
                      context.chart.data &&
                      context.chart.data.datasets &&
                      context.chart.data.datasets[0] &&
                      context.chart.data.datasets[0].data) || [];
                  const total = dataArr.reduce(function (sum, v) {
                    return sum + (typeof v === "number" ? v : 0);
                  }, 0);
                  const pct = total
                    ? ((value / total) * 100).toFixed(1)
                    : "0.0";
                  return (
                    label +
                    ": " +
                    value.toLocaleString("es-MX") +
                    " L (" +
                    pct +
                    "%)"
                  );
                },
              },
            },
            dashboardDoughnutCenter: {
              label: "Litros hoy",
              color: axisFuelColor,
              fontSize: 15,
            },
          },
          cutout: "65%",
        },
        plugins: [dashboardDoughnutCenter],
      });
    }
  }

  // Refresco periódico para modo TV (si está visible)
  setInterval(() => {
    const tvView = document.getElementById("admin-view-tv");
    if (tvView && tvView.classList.contains("is-active")) {
      renderTvView();
    }
  }, 60000);

  // Inactividad admin: resetear temporizador en eventos de usuario
  ["click", "keydown", "mousemove"].forEach((evt) => {
    window.addEventListener(evt, resetAdminIdleTimer, { passive: true });
  });
  resetAdminIdleTimer();
}

function renderDashboard() {
  const stationNameEl = document.getElementById("dash-station-name");
  const stationLocEl = document.getElementById("dash-station-location");
  const salesEl = document.getElementById("dash-sales");
  const salesBarEl = document.getElementById("dash-sales-bar");
  const litersEl = document.getElementById("dash-liters");
  const litersSubEl = document.getElementById("dash-liters-sub");
  const lastInspectionEl = document.getElementById("dash-last-inspection");
  const incidentsEl = document.getElementById("dash-incidents");
  const summaryLogsTodayEl = document.getElementById("summary-logs-today");
  const summaryIncTodayEl = document.getElementById("summary-incidents-today");
  const summaryAlertsEvidenceEl = document.getElementById("summary-alerts-evidence");
  const summaryFuelTodayEl = document.getElementById("summary-fuel-today");
  const summaryTasksTotalEl = document.getElementById("summary-tasks-total");
  const summaryTasksPendingEl = document.getElementById("summary-tasks-pending");
  const summaryTasksEvidenceEl = document.getElementById("summary-tasks-evidence");
  const summaryTasksNotesEl = document.getElementById("summary-tasks-notes");
  const fuelRiskEl = document.getElementById("dash-fuel-risk");
  const fuelRiskSubEl = document.getElementById("dash-fuel-risk-sub");
  const shiftsSummaryEl = document.getElementById("dash-shifts-summary");
  const shiftsFuelEl = document.getElementById("dash-shifts-fuel");

  if (!stationNameEl || !stationLocEl || !salesEl || !litersEl) return;

  let stationName = "Sin estación asignada";
  let stationLoc = "-";

  const stationRefId =
    dashboardStationId ||
    assignedStationId ||
    (adminState.stations[0] && adminState.stations[0].id) ||
    "";

  if (stationRefId) {
    const st = adminState.stations.find((s) => s.id === stationRefId);
    if (st) {
      stationName = st.name;
      stationLoc = st.location || "";
    }
  } else if (adminState.stations[0]) {
    stationName = adminState.stations[0].name;
    stationLoc = adminState.stations[0].location || "";
  }

  stationNameEl.textContent = stationName;
  stationLocEl.textContent = stationLoc || "-";
  // Métricas básicas de cumplimiento basadas en los logs

  const logsForStation = adminState.logs.filter((log) =>
    stationRefId ? log.stationId === stationRefId : true
  );

  let incidentsCount = 0;
  let okCount = 0;
   let overdueCount = 0;
  let lastInspection = "-";
  let lastKey = "";

  const freqCounts = {
    unica: 0,
    diaria: 0,
    semanal: 0,
    mensual: 0,
    bimestral: 0,
    trimestral: 0,
    anual: 0,
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  let logsToday = 0;
  let incidentsToday = 0;
  let alertsWithEvidence = 0;
  let fuelDeliveriesToday = 0;
  let fuelLitersToday = 0;
  const fuelTypeTodayStats = {};
  const shiftsToday = {
    matutino: { logs: 0, fuel: 0 },
    vespertino: { logs: 0, fuel: 0 },
    nocturno: { logs: 0, fuel: 0 },
  };
  let lastFuelDate = null;

  logsForStation.forEach((log) => {
    if (log.status === "ok") okCount += 1;
    if (log.status === "warning" || log.status === "error") incidentsCount += 1;
    if (isPastDue(log.date) && log.status !== "ok") overdueCount += 1;

    if (log.date === todayStr) {
      logsToday += 1;
      if (log.status === "warning" || log.status === "error") {
        incidentsToday += 1;
      }
      const shiftKey = (log.shift || "").toLowerCase();
      const bucket =
        shiftKey === "vespertino"
          ? shiftsToday.vespertino
          : shiftKey === "nocturno"
          ? shiftsToday.nocturno
          : shiftsToday.matutino;
      bucket.logs += 1;
      const isFuel =
        (log.incidentType || "") === "Recepción de pipa" ||
        (log.entry && String(log.entry).indexOf("Recepción de pipa") !== -1);
      if (isFuel) {
        fuelDeliveriesToday += 1;
        if (typeof log.fuelLiters === "number" && !isNaN(log.fuelLiters)) {
          fuelLitersToday += log.fuelLiters;
          const typeLabel = (log.fuelType || "Otro").toString();
          if (!fuelTypeTodayStats[typeLabel]) {
            fuelTypeTodayStats[typeLabel] = 0;
          }
          fuelTypeTodayStats[typeLabel] += log.fuelLiters;
        }

        bucket.fuel += 1;
      }
    }

    const freqKey = (log.frequency || "unica").toLowerCase();
    if (freqCounts.hasOwnProperty(freqKey)) {
      freqCounts[freqKey] += 1;
    }

    if (log.date) {
      const key = `${log.date}T${log.time || "00:00"}`;
      if (!lastKey || key > lastKey) {
        lastKey = key;
        lastInspection = formatDateShort(log.date);
      }
    }

    // Última recepción de pipa en esta estación
    const isFuelAny =
      (log.incidentType || "") === "Recepción de pipa" ||
      (log.entry && String(log.entry).indexOf("Recepción de pipa") !== -1);
    if (isFuelAny && log.date) {
      if (!lastFuelDate || log.date > lastFuelDate) {
        lastFuelDate = log.date;
      }
    }

    const hasEvidence = log.evidenceUrl && String(log.evidenceUrl).trim() !== "";
    const isIncident =
      log.status === "warning" ||
      log.status === "error" ||
      !!(log.severity && log.severity !== "");
    if (isIncident && hasEvidence) {
      alertsWithEvidence += 1;
    }
  });

  const totalLogs = logsForStation.length;

  if (salesEl) {
    const pct = totalLogs ? Math.round((okCount / totalLogs) * 100) : 0;
    salesEl.textContent = `${pct}%`;
    if (salesBarEl) {
      salesBarEl.style.width = `${pct}%`;
    }
  }
  if (litersEl) {
    const litersLabel = fuelLitersToday > 0 ? `${fuelLitersToday.toLocaleString("es-MX")} L` : "0 L";
    litersEl.textContent = litersLabel;
    if (litersSubEl) {
      // Comparar contra promedio de los últimos 7 días (excluyendo hoy)
      let sumPrev = 0;
      let countPrev = 0;
      const today = new Date(todayStr + "T00:00:00");
      for (let i = 1; i <= 7; i += 1) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const iso = d.toISOString().slice(0, 10);
        let dayLiters = 0;
        logsForStation.forEach((log) => {
          if (!log.date || log.date !== iso) return;
          const isFuel =
            (log.incidentType || "") === "Recepción de pipa" ||
            (log.entry &&
              String(log.entry).indexOf("Recepción de pipa") !== -1);
          if (!isFuel) return;
          if (typeof log.fuelLiters === "number" && !isNaN(log.fuelLiters)) {
            dayLiters += log.fuelLiters;
          }
        });
        if (dayLiters > 0) {
          sumPrev += dayLiters;
          countPrev += 1;
        }
      }

      if (countPrev > 0) {
        const avg = sumPrev / countPrev;
        const diffPct = avg
          ? Math.round(((fuelLitersToday - avg) / avg) * 100)
          : 0;
        const arrow = diffPct > 0 ? "▲" : diffPct < 0 ? "▼" : "=";
        litersSubEl.textContent =
          `Volumen del día · ${arrow} vs prom. últimos ${countPrev} días con pipas: ` +
          `${Math.round(avg).toLocaleString("es-MX")} L (${diffPct >= 0 ? "+" : ""}${diffPct}%)`;
      } else {
        litersSubEl.textContent = "Volumen del día (sin historial de pipas reciente).";
      }
    }
  }
  if (lastInspectionEl) {
    lastInspectionEl.textContent = lastInspection;
  }
  if (incidentsEl) {
    incidentsEl.textContent = `Incidencias: ${incidentsCount}`;
  }

  // Riesgo de desabasto según días desde la última pipa
  if (fuelRiskEl && fuelRiskSubEl) {
    if (!lastFuelDate) {
      fuelRiskEl.textContent = "Sin datos";
      fuelRiskSubEl.textContent =
        "Sin recepciones de pipa registradas para esta estación.";
    } else {
      const last = new Date(lastFuelDate + "T00:00:00");
      const nowDate = new Date(todayStr + "T00:00:00");
      const diffMs = nowDate.getTime() - last.getTime();
      const daysSince = Math.max(
        0,
        Math.round(diffMs / (1000 * 60 * 60 * 24))
      );

      let level = "Bajo";
      if (daysSince >= 6) level = "Alto";
      else if (daysSince >= 3) level = "Medio";

      fuelRiskEl.textContent = `${level} (${daysSince} días)`;
      fuelRiskSubEl.textContent = `Última pipa: ${formatDateShort(
        lastFuelDate
      )}`;
    }
  }

  // Resumen por turno (hoy)
  if (shiftsSummaryEl) {
    shiftsSummaryEl.textContent =
      `Matutino: ${shiftsToday.matutino.logs} · Vespertino: ${
        shiftsToday.vespertino.logs
      } · Nocturno: ${shiftsToday.nocturno.logs}`;
  }
  if (shiftsFuelEl) {
    shiftsFuelEl.textContent =
      `Pipas — Mat: ${shiftsToday.matutino.fuel} · Vesp: ${
        shiftsToday.vespertino.fuel
      } · Noc: ${shiftsToday.nocturno.fuel}`;
  }

  // Resumen superior "hoy" (logs e incidentes)
  if (summaryLogsTodayEl) {
    const valueSpan = summaryLogsTodayEl.querySelector(".admin-summary-value");
    if (valueSpan) valueSpan.textContent = String(logsToday);
  }
  if (summaryIncTodayEl) {
    const valueSpan = summaryIncTodayEl.querySelector(".admin-summary-value");
    if (valueSpan) valueSpan.textContent = String(incidentsToday);
  }

  if (summaryAlertsEvidenceEl) {
    const valueSpan = summaryAlertsEvidenceEl.querySelector(".admin-summary-value");
    if (valueSpan) valueSpan.textContent = String(alertsWithEvidence);
  }

  if (summaryFuelTodayEl) {
    const valueSpan = summaryFuelTodayEl.querySelector(".admin-summary-value");
    if (valueSpan) valueSpan.textContent = String(fuelDeliveriesToday);
  }

  // Leer tareas del módulo operativo para KPIs de tareas
  let totalTasks = 0;
  let pendingTasks = 0;
  let tasksWithEvidence = 0;
  let tasksWithNotes = 0;
  let criticalTasks = [];
  try {
    const rawOps = window.localStorage.getItem("cog-work-log-data");
    if (rawOps) {
      const parsedOps = JSON.parse(rawOps);
      const tasks = Array.isArray(parsedOps.tasks) ? parsedOps.tasks : [];

      // Filtrar tareas por estación activa del panel
      let scopedTasks = tasks;
      const activeStationName =
        stationRefId && stationName !== "Sin estación asignada" ? stationName : "";
      if (activeStationName) {
        scopedTasks = tasks.filter((t) => {
          const tStation = t && t.station ? String(t.station) : "";
          return (
            tStation === activeStationName ||
            tStation === "Cobertura multiestación"
          );
        });
      }

      totalTasks = scopedTasks.length;
      pendingTasks = scopedTasks.filter((t) => t.status === "pendiente").length;
      tasksWithEvidence = scopedTasks.filter(
        (t) => t.evidenceUrl && String(t.evidenceUrl).trim() !== ""
      ).length;
      tasksWithNotes = scopedTasks.filter(
        (t) => t.notes && String(t.notes).trim() !== ""
      ).length;

      // Seleccionar próximas tareas críticas (prioridad alta o próximas fechas)
      criticalTasks = scopedTasks
        .filter(function (t) {
          var pr = (t && t.priority) || "";
          if (pr.toLowerCase && pr.toLowerCase() === "alta") return true;
          // Considerar también tareas próximas aunque no sean alta
          var due = (t && t.dueDate) || "";
          return !!due;
        })
        .sort(function (a, b) {
          var aKey = ((a && a.dueDate) || "9999-12-31") + "T" + ((a && a.dueTime) || "23:59");
          var bKey = ((b && b.dueDate) || "9999-12-31") + "T" + ((b && b.dueTime) || "23:59");
          if (aKey < bKey) return -1;
          if (aKey > bKey) return 1;
          return 0;
        })
        .slice(0, 4);
    }
  } catch (e) {
    console.error("No se pudieron leer tareas para resumen del dashboard", e);
  }

  if (summaryTasksTotalEl) {
    const valueSpan = summaryTasksTotalEl.querySelector(".admin-summary-value");
    if (valueSpan) valueSpan.textContent = String(totalTasks);
  }
  if (summaryTasksPendingEl) {
    const valueSpan = summaryTasksPendingEl.querySelector(".admin-summary-value");
    if (valueSpan) valueSpan.textContent = String(pendingTasks);
  }

  if (summaryTasksEvidenceEl) {
    const valueSpan = summaryTasksEvidenceEl.querySelector(".admin-summary-value");
    if (valueSpan) valueSpan.textContent = String(tasksWithEvidence);
  }
  if (summaryTasksNotesEl) {
    const valueSpan = summaryTasksNotesEl.querySelector(".admin-summary-value");
    if (valueSpan) valueSpan.textContent = String(tasksWithNotes);
  }

  // Renderizar listado de próximas tareas críticas en el panel
  var tasksListEl = document.getElementById("dashboard-tasks-list");
  if (tasksListEl) {
    if (!criticalTasks || !criticalTasks.length) {
      tasksListEl.innerHTML =
        '<li class="admin-dashboard-task-item"><span class="admin-dashboard-task-title">Sin tareas críticas</span><div class="admin-dashboard-task-meta"><span>No hay tareas próximas para esta estación.</span></div></li>';
    } else {
      tasksListEl.innerHTML = "";
      criticalTasks.forEach(function (t) {
        var li = document.createElement("li");
        li.className = "admin-dashboard-task-item";

        var title = document.createElement("div");
        title.className = "admin-dashboard-task-title";
        title.textContent = t.title || "Tarea";

        var meta = document.createElement("div");
        meta.className = "admin-dashboard-task-meta";
        var dateSpan = document.createElement("span");
        var dueDate = t.dueDate || "";
        var dueTime = t.dueTime || "";
        var whenLabel = "Sin fecha";
        if (dueDate) {
          whenLabel = formatDateShort(dueDate) + (dueTime ? " · " + dueTime : "");
        }
        dateSpan.textContent = whenLabel;

        var statusSpan = document.createElement("span");
        var statusLabel = (t.status || "").toLowerCase();
        if (statusLabel === "pendiente") statusSpan.textContent = "Pendiente";
        else if (statusLabel === "en_progreso" || statusLabel === "in_progress")
          statusSpan.textContent = "En progreso";
        else if (statusLabel === "completada" || statusLabel === "hecha")
          statusSpan.textContent = "Completada";
        else statusSpan.textContent = t.status || "";

        meta.appendChild(dateSpan);
        meta.appendChild(statusSpan);

        var tags = document.createElement("div");
        tags.className = "admin-dashboard-task-tags";

        var pr = (t.priority || "").toLowerCase ? t.priority.toLowerCase() : t.priority;
        if (pr === "alta") {
          var tagCrit = document.createElement("span");
          tagCrit.className = "admin-dashboard-task-tag admin-dashboard-task-tag-critical";
          tagCrit.textContent = "Crítica";
          tags.appendChild(tagCrit);
        }

        if (statusLabel === "pendiente") {
          var tagPend = document.createElement("span");
          tagPend.className = "admin-dashboard-task-tag admin-dashboard-task-tag-pending";
          tagPend.textContent = "Pendiente";
          tags.appendChild(tagPend);
        }

        if (t.evidenceUrl && String(t.evidenceUrl).trim() !== "") {
          var tagEvi = document.createElement("span");
          tagEvi.className = "admin-dashboard-task-tag admin-dashboard-task-tag-evidence";
          tagEvi.textContent = "Con evidencia";
          tags.appendChild(tagEvi);
        }

        if (t.notes && String(t.notes).trim() !== "") {
          var tagNotes = document.createElement("span");
          tagNotes.className = "admin-dashboard-task-tag admin-dashboard-task-tag-notes";
          tagNotes.textContent = "Con observaciones";
          tags.appendChild(tagNotes);
        }

        // Permitir navegar a la vista de actividades con un clic
        li.style.cursor = "pointer";
        li.onclick = function () {
          try {
            // Aplicar filtros en Actividades: estación y palabra clave de la tarea
            var activitiesStation = document.getElementById(
              "activities-filter-station"
            );
            var activitiesSearch = document.getElementById(
              "activities-search"
            );

            if (activitiesStation && stationName !== "Sin estación asignada") {
              // stationLabel en actividades es el nombre de la estación
              activitiesStation.value = stationName;
            }

            if (activitiesSearch && t.title) {
              activitiesSearch.value = t.title;
            }

            setAdminView("activities");
            renderActivitiesView();
          } catch (e) {
            console.error("No se pudo navegar a Actividades desde dashboard", e);
          }
        };

        li.appendChild(title);
        li.appendChild(meta);
        if (tags.childNodes.length) {
          li.appendChild(tags);
        }

        tasksListEl.appendChild(li);
      });
    }
  }

  const topIncEl = document.getElementById("topbar-incidents");
  const topOverEl = document.getElementById("topbar-overdue");
  if (topIncEl) {
    topIncEl.textContent = `Incidencias: ${incidentsCount}`;
  }
  if (topOverEl) {
    topOverEl.textContent = `Vencidos: ${overdueCount}`;
  }

  updateDashboardCharts({
    okCount,
    warningCount: logsForStation.filter((l) => l.status === "warning").length,
    errorCount: logsForStation.filter((l) => l.status === "error").length,
    freqCounts,
    fuelTypeTodayStats,
  });
}

window.addEventListener("DOMContentLoaded", () => {
  if (!isAuthenticated()) {
    window.location.href = "login.html";
    return;
  }

  // Cargar datos desde backend si existe, luego aplicar flujo normal basado en localStorage
  (async function initAdmin() {
    await syncAdminStateFromBackendIfAvailable();
    loadAdminState();
  currentUser = getCurrentUser();
  resolveAssignedStationId();
  applySavedTheme();
  hydrateLogStationSelect();
  hydrateLogFilterStationSelect();
  hydrateUserStationSelect();
  hydrateDashboardStationSelect();
  initActivitiesFilters && initActivitiesFilters();
  setupAdminEvents();
  setupThemeToggle();
  setAdminView("dashboard");

  const userEl = document.querySelector(".admin-topbar-user");
  if (userEl) {
    let roleLabel = "Operador";
    if (currentUser.role === "admin") roleLabel = "Administrador";
    else if (currentUser.role === "jefe_estacion") roleLabel = "Jefe de estación";
    else if (currentUser.role === "auditor") roleLabel = "Auditor";
    else if (currentUser.role === "supervisor") roleLabel = "Supervisor regional";
    userEl.textContent = `${currentUser.name} · ${roleLabel}`;
  }

  applySidebarByRole();

  window.addEventListener("storage", (event) => {
    if (!event) return;
    if (event.key && !event.key.startsWith(AUTH_KEY)) return;
    if (!isAuthenticated()) {
      window.location.href = "login.html";
    }
  });
  })();
});
