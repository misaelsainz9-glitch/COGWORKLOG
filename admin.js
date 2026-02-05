const ADMIN_STORAGE_KEY = "cog-work-log-admin";
const THEME_STORAGE_KEY = "cog-work-log-theme";
const LOGIN_ATTEMPTS_KEY = "cog-work-log-login-attempts";
// Configuración opcional de backend para administración
// Usamos misma origen (Render o servidor local que sirve los estáticos y la API)
const BACKEND_URL = "";
const BACKEND_ADMIN_ENABLED = true;
// Versión de esquema de datos de administración para poder regenerar seeds cuando cambian
// Incrementa este valor cuando cambies usuarios/estructura semilla
const ADMIN_DATA_VERSION = 11;
const LOG_FILTERS_KEY = "cog-work-log-admin-log-filters";
const REPORT_FILTERS_KEY = "cog-work-log-admin-report-filters";
const ALERT_FILTERS_KEY = "cog-work-log-admin-alert-filters";
const OPERATIONS_STORAGE_KEY = "cog-work-log-data";
const ADMIN_LAST_SYNC_KEY = "cog-work-log-admin-last-sync";

const DEFAULT_SECURITY_SETTINGS = {
  maxFailedAttempts: 5,
  lockWindowMinutes: 10,
  passwordExpiryDays: 90,
};

const DEFAULT_ALERT_SETTINGS = {
  enableCriticalAlerts: true,
  enableStationBurstAlerts: true,
  stationBurstThreshold: 3,
  stationBurstWindowMinutes: 60,
};

let adminState = {
  version: ADMIN_DATA_VERSION,
  stations: [],
  logs: [],
  generalLogs: [],
  users: [],
  shifts: [],
  securitySettings: { ...DEFAULT_SECURITY_SETTINGS },
  alertSettings: { ...DEFAULT_ALERT_SETTINGS },
  alerts: [],
  maintenance: [],
};

// Estado auxiliar para vistas de estaciones / globo
let stationsHighlightId = ""; // estación a resaltar al abrir la vista de estaciones
let stationsEditingId = ""; // estación actualmente en edición desde el formulario
let pendingLogStationFilterId = ""; // filtro de estación a aplicar al abrir la vista de bitácora desde el globo

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
      securitySettings:
        adminState.securitySettings || { ...DEFAULT_SECURITY_SETTINGS },
      alertSettings: adminState.alertSettings || { ...DEFAULT_ALERT_SETTINGS },
      alerts: Array.isArray(adminState.alerts) ? adminState.alerts : [],
      maintenance: Array.isArray(adminState.maintenance)
        ? adminState.maintenance
        : [],
    })
  );

  // Best-effort: reflejar cambios también en backend si está disponible
  syncAdminStateToBackendIfAvailable();
}

// Datos semilla mínimos: sin estaciones ni bitácoras demo, solo el usuario inicial
function seedAdminState() {
  const todayIso = new Date().toISOString().slice(0, 10);

  adminState.version = ADMIN_DATA_VERSION;
  adminState.stations = [];
  adminState.logs = [];
  adminState.generalLogs = [];

  adminState.users = [
    {
      id: 1,
      name: "Misa",
      username: "misa",
      password: "Pepepito2",
      role: "admin",
      stationId: "",
      area: "Corporativo",
      passwordLastChanged: todayIso,
      locked: false,
    },
  ];

  // Catálogo de turnos inicia vacío; se irán agregando desde la vista de Gestión turnos
  adminState.shifts = [];

  // Políticas de seguridad por defecto
  adminState.securitySettings = { ...DEFAULT_SECURITY_SETTINGS };

  // Configuración de alertas por defecto
  adminState.alertSettings = { ...DEFAULT_ALERT_SETTINGS };
  adminState.alerts = [];
  adminState.maintenance = [];
}

function getSecuritySettingsFromState() {
  const base = { ...DEFAULT_SECURITY_SETTINGS };
  const cfg = adminState && adminState.securitySettings;
  if (cfg && typeof cfg === "object") {
    if (typeof cfg.maxFailedAttempts === "number" && cfg.maxFailedAttempts > 0) {
      base.maxFailedAttempts = cfg.maxFailedAttempts;
    }
    if (typeof cfg.lockWindowMinutes === "number" && cfg.lockWindowMinutes > 0) {
      base.lockWindowMinutes = cfg.lockWindowMinutes;
    }
    if (
      typeof cfg.passwordExpiryDays === "number" &&
      cfg.passwordExpiryDays > 0 &&
      cfg.passwordExpiryDays <= 365
    ) {
      base.passwordExpiryDays = cfg.passwordExpiryDays;
    }
  }
  adminState.securitySettings = base;
  return base;
}

function getAlertSettingsFromState() {
  const base = { ...DEFAULT_ALERT_SETTINGS };
  const cfg = adminState && adminState.alertSettings;
  if (cfg && typeof cfg === "object") {
    if (typeof cfg.enableCriticalAlerts === "boolean") {
      base.enableCriticalAlerts = cfg.enableCriticalAlerts;
    }
    if (typeof cfg.enableStationBurstAlerts === "boolean") {
      base.enableStationBurstAlerts = cfg.enableStationBurstAlerts;
    }
    if (
      typeof cfg.stationBurstThreshold === "number" &&
      cfg.stationBurstThreshold >= 2
    ) {
      base.stationBurstThreshold = cfg.stationBurstThreshold;
    }
    if (
      typeof cfg.stationBurstWindowMinutes === "number" &&
      cfg.stationBurstWindowMinutes >= 15
    ) {
      base.stationBurstWindowMinutes = cfg.stationBurstWindowMinutes;
    }
  }
  adminState.alertSettings = base;
  if (!Array.isArray(adminState.alerts)) {
    adminState.alerts = [];
  }
  return base;
}

function ensureAlertsArray() {
  if (!Array.isArray(adminState.alerts)) {
    adminState.alerts = [];
  }
  return adminState.alerts;
}

function nextAlertId() {
  const alerts = ensureAlertsArray();
  const max = alerts.reduce((m, a) => Math.max(m, a.id || 0), 0);
  return max + 1;
}

function evaluateAlertRulesForLog(log) {
  const settings = getAlertSettingsFromState();
  const triggered = [];

  const isIncident =
    log && (log.status === "warning" || log.status === "error");

  if (
    settings.enableCriticalAlerts &&
    log &&
    log.status === "error" &&
    (log.severity || "").toLowerCase() === "alta"
  ) {
    triggered.push({
      rule: "critical_incident",
      level: "critico",
      message: "Incidente crítico (error · severidad alta)",
    });
  }

  if (
    settings.enableStationBurstAlerts &&
    log &&
    log.stationId &&
    isIncident
  ) {
    const minutes = settings.stationBurstWindowMinutes || 60;
    const threshold = settings.stationBurstThreshold || 3;
    const now = new Date();
    const windowMs = minutes * 60 * 1000;

    let count = 0;
    (adminState.logs || []).forEach((l) => {
      if (!l || l.stationId !== log.stationId) return;
      if (!(l.status === "warning" || l.status === "error")) return;
      const ts = l.createdAt || `${l.date || ""}T${l.time || ""}`;
      if (!ts) return;
      const d = new Date(ts);
      if (!d || isNaN(d.getTime())) return;
      if (now.getTime() - d.getTime() <= windowMs) {
        count += 1;
      }
    });

    if (count >= threshold) {
      triggered.push({
        rule: "station_burst",
        level: "alto",
        message: `Racha de incidentes en la estación (>${threshold - 1} en ${minutes} min)` ,
      });
    }
  }

  return triggered;
}

async function createAlertsForLog(log) {
  const rules = evaluateAlertRulesForLog(log);
  if (!rules.length) return;

  const alerts = ensureAlertsArray();
  const station =
    (adminState.stations || []).find((s) => s.id === log.stationId) || null;

  const nowIso = new Date().toISOString();

  rules.forEach((rule) => {
    const alert = {
      id: nextAlertId(),
      createdAt: nowIso,
      logId: log.id,
      stationId: log.stationId || "",
      stationName: station ? station.name : "",
      user: log.user || "",
      description: log.description || "",
      incidentType: log.incidentType || "",
      severity: log.severity || "",
      status: "activa",
      rule: rule.rule,
      level: rule.level,
      message: rule.message,
    };
    alerts.push(alert);

    try {
      addGeneralLogEntry(
        "Alerta generada",
        `${alert.message} para el registro ${log.id} (${alert.stationName || "Sin estación"}).`,
        "warning"
      );
    } catch (e) {
      // silencioso
    }

    try {
      notifyBackendAboutAlert(alert).catch(() => {});
    } catch (e) {
      // silencioso
    }
  });

  saveAdminState();
  try {
    updateTopbarAlertMetrics();
    renderAlertsView();
    renderSecurityView();
    renderTvView();
  } catch (e) {
    // silencioso
  }
}

async function notifyBackendAboutAlert(alert) {
  if (!BACKEND_ADMIN_ENABLED || !BACKEND_URL) return;
  try {
    await fetch(`${BACKEND_URL}/api/notify-alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: alert.rule,
        level: alert.level,
        message: alert.message,
        stationId: alert.stationId,
        stationName: alert.stationName,
        severity: alert.severity,
        logId: alert.logId,
      }),
    });
  } catch (e) {
    // silencioso
  }
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
    "stations-globe": "admin-view-stations-globe",
    tv: "admin-view-tv",
    security: "admin-view-security",
    settings: "admin-view-settings",
    maintenance: "admin-view-maintenance",
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
    // Restaurar filtros guardados de bitácora (si existen)
    try {
      const raw = window.localStorage.getItem(LOG_FILTERS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && typeof saved === "object") {
          const filterStation = document.getElementById("log-filter-station");
          const filterStatus = document.getElementById("log-filter-status");
          const filterFreq = document.getElementById("log-filter-frequency");
          const filterFuelType = document.getElementById("log-filter-fueltype");
          const filterFrom = document.getElementById("log-filter-from");
          const filterTo = document.getElementById("log-filter-to");
          const filterShift = document.getElementById("log-filter-shift");
          const searchEl = document.getElementById("log-search");

          if (filterStation && saved.stationId != null)
            filterStation.value = saved.stationId;
          if (filterStatus && saved.status != null)
            filterStatus.value = saved.status;
          if (filterFreq && saved.frequency != null)
            filterFreq.value = saved.frequency;
          if (filterFuelType && saved.fuelType != null)
            filterFuelType.value = saved.fuelType;
          if (filterFrom && saved.fromDate != null)
            filterFrom.value = saved.fromDate;
          if (filterTo && saved.toDate != null) filterTo.value = saved.toDate;
          if (filterShift && saved.shift != null)
            filterShift.value = saved.shift;
          if (searchEl && saved.search != null)
            searchEl.value = saved.search;

          // Si venimos desde el globo con una estación específica, forzar ese filtro
          if (pendingLogStationFilterId && filterStation) {
            filterStation.value = pendingLogStationFilterId;
          }
        }
      }
    } catch (e) {
      // silencioso
    }

    renderLogs();
    pendingLogStationFilterId = "";
    if (!adminCalendar) {
      initAdminCalendar();
    } else {
      adminCalendar.updateSize();
      refreshAdminCalendarEvents();
    }
  }
  if (viewKey === "alerts") {
    // Asegurar que las alertas y su configuración estén normalizadas
    getAlertSettingsFromState();
    ensureAlertsArray();
    // Restaurar filtros guardados de alertas (si existen)
    try {
      const raw = window.localStorage.getItem(ALERT_FILTERS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && typeof saved === "object") {
          const stationSelect = document.getElementById(
            "alerts-filter-station"
          );
          const severitySelect = document.getElementById(
            "alerts-filter-severity"
          );
          const fromInput = document.getElementById("alerts-filter-from");
          const toInput = document.getElementById("alerts-filter-to");
          const sentOnlyInput = document.getElementById("alerts-filter-sent");
          const searchEl = document.getElementById("alerts-search");

          if (stationSelect && saved.stationId != null)
            stationSelect.value = saved.stationId;
          if (severitySelect && saved.severity != null)
            severitySelect.value = saved.severity;
          if (fromInput && saved.fromDate != null)
            fromInput.value = saved.fromDate;
          if (toInput && saved.toDate != null) toInput.value = saved.toDate;
          if (sentOnlyInput && typeof saved.sentOnly === "boolean")
            sentOnlyInput.checked = saved.sentOnly;
          if (searchEl && saved.search != null)
            searchEl.value = saved.search;
        }
      }
    } catch (e) {
      // silencioso
    }

    renderAlerts();
  }
  if (viewKey === "general") renderGeneralLogs();
  if (viewKey === "activities") renderActivitiesView();
  if (viewKey === "stations") renderStations();
  if (viewKey === "stations-globe") {
    initStationsGlobe();
  }
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
  if (viewKey === "security") {
    renderSecurityView();
  }
  if (viewKey === "settings") {
    renderSettingsView();
  }
  if (viewKey === "maintenance") {
    hydrateMaintenanceStationSelect();
    renderMaintenanceView();
  }
}

function renderSettingsView() {
  const settings = getSecuritySettingsFromState();
  const alertSettings = getAlertSettingsFromState();
  const maxFailedInput = document.getElementById("settings-max-failed");
  const lockWindowInput = document.getElementById("settings-lock-window");
  const expiryInput = document.getElementById("settings-password-expiry");
  const burstThresholdInput = document.getElementById(
    "settings-alert-burst-threshold"
  );
  const burstWindowInput = document.getElementById(
    "settings-alert-burst-window"
  );
  const criticalToggle = document.getElementById(
    "settings-alert-critical-enabled"
  );
  const burstToggle = document.getElementById(
    "settings-alert-burst-enabled"
  );

  if (maxFailedInput) {
    maxFailedInput.value = String(settings.maxFailedAttempts);
  }
  if (lockWindowInput) {
    lockWindowInput.value = String(settings.lockWindowMinutes);
  }
  if (expiryInput) {
    expiryInput.value = String(settings.passwordExpiryDays);
  }
  if (burstThresholdInput) {
    burstThresholdInput.value = String(alertSettings.stationBurstThreshold);
  }
  if (burstWindowInput) {
    burstWindowInput.value = String(alertSettings.stationBurstWindowMinutes);
  }
  if (criticalToggle) {
    criticalToggle.checked = !!alertSettings.enableCriticalAlerts;
  }
  if (burstToggle) {
    burstToggle.checked = !!alertSettings.enableStationBurstAlerts;
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

    if (log.status && String(log.status).toLowerCase() !== "ok") {
      tr.classList.add("admin-row-nok");
    }

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

  // Guardar filtros actuales de alertas
  try {
    const filters = {
      stationId: stationIdFilter,
      severity: severityFilter,
      fromDate,
      toDate,
      sentOnly,
      search,
    };
    window.localStorage.setItem(ALERT_FILTERS_KEY, JSON.stringify(filters));
  } catch (e) {
    // silencioso
  }

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

    const infoEl = document.getElementById("alerts-pagination-info");
    if (infoEl) {
      infoEl.textContent = "0 alertas";
    }
    const prevBtn = document.getElementById("alerts-page-prev");
    const nextBtn = document.getElementById("alerts-page-next");
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  const sorted = rows
    .slice()
    .sort((a, b) => {
      const ad = a.log.date || "";
      const bd = b.log.date || "";
      const at = a.log.time || "";
      const bt = b.log.time || "";
      const k1 = ad + at;
      const k2 = bd + bt;
      return k2.localeCompare(k1); // más recientes primero
    });

  const total = sorted.length;
  const maxPage = total ? Math.ceil(total / ALERTS_PAGE_SIZE) : 1;
  if (alertsPage > maxPage) alertsPage = maxPage;
  if (alertsPage < 1) alertsPage = 1;

  const start = (alertsPage - 1) * ALERTS_PAGE_SIZE;
  const pageItems = sorted.slice(start, start + ALERTS_PAGE_SIZE);

  const from = start + 1;
  const to = start + pageItems.length;

  pageItems.forEach(({ log, station }) => {
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

  const infoEl = document.getElementById("alerts-pagination-info");
  if (infoEl) {
    infoEl.textContent = `Mostrando ${from}-${to} de ${total}`;
  }
  const prevBtn = document.getElementById("alerts-page-prev");
  const nextBtn = document.getElementById("alerts-page-next");
  if (prevBtn) prevBtn.disabled = alertsPage <= 1;
  if (nextBtn) nextBtn.disabled = alertsPage >= maxPage;
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

  const todayOnlyToggle = !!generalTodayOnly;

  const filtered = [];

  adminState.generalLogs.forEach((log) => {
    const rowText = `${log.user} ${log.activity} ${log.description}`.toLowerCase();
    if (search && !rowText.includes(search)) return;
    if (todayOnlyToggle) {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (!log.date || log.date !== todayStr) return;
    }
    filtered.push(log);
  });

  if (!filtered.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9;
    td.className = "admin-empty-row";
    td.textContent = "Sin registros en la bitácora general con los filtros actuales.";
    tr.appendChild(td);
    tbody.appendChild(tr);

    const infoEl = document.getElementById("general-pagination-info");
    if (infoEl) {
      infoEl.textContent = "0 registros";
    }
    const summaryEl = document.getElementById("general-summary");
    if (summaryEl) {
      summaryEl.textContent = "Hoy: 0 · Últimos 7 días: 0 · Total: 0";
    }
    const prevBtn = document.getElementById("general-page-prev");
    const nextBtn = document.getElementById("general-page-next");
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  const total = filtered.length;
  const maxPage = total ? Math.ceil(total / GENERAL_PAGE_SIZE) : 1;
  if (generalPage > maxPage) generalPage = maxPage;
  if (generalPage < 1) generalPage = 1;

  const start = (generalPage - 1) * GENERAL_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + GENERAL_PAGE_SIZE);

  const from = start + 1;
  const to = start + pageItems.length;

  // Actualizar resumen Hoy / 7 días / Total (sobre todos los registros, no solo filtrados)
  try {
    const summaryEl = document.getElementById("general-summary");
    if (summaryEl) {
      const logs = Array.isArray(adminState.generalLogs)
        ? adminState.generalLogs
        : [];
      const todayStr = new Date().toISOString().slice(0, 10);
      let todayCount = 0;
      let last7Count = 0;
      const todayDate = new Date(todayStr + "T00:00:00");

      logs.forEach((g) => {
        if (!g || !g.date) return;
        if (g.date === todayStr) {
          todayCount += 1;
        }
        const d = new Date(g.date + "T00:00:00");
        if (isNaN(d.getTime())) return;
        const diffMs = todayDate.getTime() - d.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays >= 0 && diffDays <= 6) {
          last7Count += 1;
        }
      });

      summaryEl.textContent = `Hoy: ${todayCount} · Últimos 7 días: ${last7Count} · Total: ${logs.length}`;
    }
  } catch (e) {
    console.error("No se pudo actualizar resumen de bitácora general", e);
  }

  pageItems.forEach((log) => {
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
        generalPage = 1;
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

  const infoEl = document.getElementById("general-pagination-info");
  if (infoEl) {
    const totalAll = Array.isArray(adminState.generalLogs)
      ? adminState.generalLogs.length
      : total;
    if (totalAll && totalAll !== total) {
      infoEl.textContent = `Mostrando ${from}-${to} de ${total} (filtrados de ${totalAll})`;
    } else {
      infoEl.textContent = `Mostrando ${from}-${to} de ${total}`;
    }
  }
  const prevBtn = document.getElementById("general-page-prev");
  const nextBtn = document.getElementById("general-page-next");
  if (prevBtn) prevBtn.disabled = generalPage <= 1;
  if (nextBtn) nextBtn.disabled = generalPage >= maxPage;
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

  let highlightedCard = null;

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
    const years = [];
    if (st.yearFrom) years.push(`Desde ${st.yearFrom}`);
    if (st.yearTo) years.push(`Hasta ${st.yearTo}`);
    const yearsText = years.length ? ` · ${years.join(" · ")}` : "";
    const isActive = st.active !== false;
    let statusText = "";
    if (!isActive) {
      statusText = yearsText ? " · Inactiva" : "Inactiva";
    }
    meta.textContent = `${st.location || "Sin ubicación"}${yearsText}${statusText}`;
    header.appendChild(nameEl);
    header.appendChild(meta);

    const desc = document.createElement("div");
    desc.className = "admin-station-meta";
    desc.textContent = st.description;

    const employeesWrap = document.createElement("div");
    employeesWrap.className = "admin-station-employees";

    // Construir lista de usuarios ligados a la estación (jefe y operadores)
    const stationUsers = (adminState.users || []).filter(
      (u) => u.stationId === st.id
    );

    const headerRow = document.createElement("div");
    headerRow.className = "admin-station-employees-header";

    const title = document.createElement("div");
    title.className = "admin-station-employees-title";
    title.textContent = "Equipo";
    headerRow.appendChild(title);

    if (can("manageUsers")) {
      const actionsRow = document.createElement("div");
      actionsRow.className = "admin-station-employees-actions";

      const reassignChiefBtn = document.createElement("button");
      reassignChiefBtn.type = "button";
      reassignChiefBtn.className = "ghost-btn";
      reassignChiefBtn.textContent = "Jefe";
      reassignChiefBtn.title = "Reasignar jefe de estación";
      reassignChiefBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const jefe = (adminState.users || []).find(
          (u) => u.role === "jefe_estacion" && u.stationId === st.id
        );
        setAdminView("users");
        const searchEl = document.getElementById("users-search");
        if (searchEl && jefe) {
          searchEl.value = jefe.username || jefe.name || "";
        }
        renderUsers();
      });
      actionsRow.appendChild(reassignChiefBtn);

      const manageOpsBtn = document.createElement("button");
      manageOpsBtn.type = "button";
      manageOpsBtn.className = "ghost-btn";
      manageOpsBtn.textContent = "Operadores";
      manageOpsBtn.title = "Gestionar operadores de esta estación";
      manageOpsBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        setAdminView("users");
        const roleFilter = document.getElementById("users-filter-role");
        if (roleFilter) {
          roleFilter.value = "empleado";
        }
        const searchEl = document.getElementById("users-search");
        if (searchEl) {
          searchEl.value = st.name || "";
        }
        renderUsers();
      });
      actionsRow.appendChild(manageOpsBtn);

      headerRow.appendChild(actionsRow);
    }

    employeesWrap.appendChild(headerRow);

    const list = document.createElement("div");
    if (stationUsers.length) {
      list.textContent = stationUsers
        .map((u) => `${u.name} (${u.role || ""})`)
        .join(", ");
    } else {
      list.textContent = "Sin operadores asignados";
    }
    employeesWrap.appendChild(list);

    const actions = document.createElement("div");
    actions.className = "admin-station-actions";

    if (can("manageStations")) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "ghost-btn admin-station-edit-btn";
      editBtn.textContent = "Editar";
      editBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();

        // Marcar visualmente la tarjeta en edición
        document
          .querySelectorAll(".admin-station-card")
          .forEach((c) => c.classList.remove("is-editing"));
        card.classList.add("is-editing");

        const form = document.getElementById("station-form");
        if (!form) return;

        const idInput = document.getElementById("station-id");
        if (idInput) idInput.value = st.id;
        stationsEditingId = st.id;

        const nameInput = document.getElementById("station-name");
        const locInput = document.getElementById("station-location");
        const descInput = document.getElementById("station-desc");
        const latInput = document.getElementById("station-lat");
        const lngInput = document.getElementById("station-lng");
        const yearFromInput = document.getElementById("station-year-from");
        const yearToInput = document.getElementById("station-year-to");

        if (nameInput) nameInput.value = st.name || "";
        if (locInput) locInput.value = st.location || "";
        if (descInput) descInput.value = st.description || "";
        if (latInput)
          latInput.value =
            typeof st.lat === "number" && !Number.isNaN(st.lat)
              ? String(st.lat)
              : "";
        if (lngInput)
          lngInput.value =
            typeof st.lng === "number" && !Number.isNaN(st.lng)
              ? String(st.lng)
              : "";
        if (yearFromInput)
          yearFromInput.value =
            typeof st.yearFrom === "number" && !Number.isNaN(st.yearFrom)
              ? String(st.yearFrom)
              : "";
        if (yearToInput)
          yearToInput.value =
            typeof st.yearTo === "number" && !Number.isNaN(st.yearTo)
              ? String(st.yearTo)
              : "";

        const submitBtn = form.querySelector("button[type='submit']");
        if (submitBtn) submitBtn.textContent = "Guardar cambios";
      });
      actions.appendChild(editBtn);

      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "ghost-btn admin-station-toggle-btn";
      toggleBtn.textContent = isActive ? "Desactivar" : "Activar";
      toggleBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const target = adminState.stations.find((s) => s.id === st.id);
        if (!target) return;

        const willDeactivate = target.active !== false;
        target.active = !willDeactivate;

        saveAdminState();
        renderStations();

        addGeneralLogEntry(
          willDeactivate ? "Desactivacion de estacion" : "Activacion de estacion",
          `${willDeactivate ? "Se desactivó" : "Se activó"} la estación ${target.name} (ID: ${target.id}).`
        );
      });
      actions.appendChild(toggleBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "danger-btn admin-station-delete-btn";
      deleteBtn.textContent = "Eliminar";
      deleteBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const confirmed = window.confirm(
          `¿Seguro que deseas eliminar la estación "${st.name}"? Esta acción no se puede deshacer.`
        );
        if (!confirmed) return;

        // Desasignar estación de usuarios vinculados
        adminState.users.forEach((u) => {
          if (u.stationId === st.id) {
            u.stationId = "";
          }
        });

        // Eliminar estación del catálogo
        adminState.stations = adminState.stations.filter(
          (s) => s.id !== st.id
        );

        saveAdminState();

        // Actualizar selects dependientes
        hydrateLogStationSelect();
        hydrateLogFilterStationSelect();
        hydrateDashboardStationSelect();
        hydrateShiftStationSelect();
        hydrateUserStationSelect();

        stationsHighlightId = "";
        if (stationsEditingId === st.id) {
          stationsEditingId = "";
          const form = document.getElementById("station-form");
          if (form) {
            form.reset();
            const idInput = document.getElementById("station-id");
            if (idInput) idInput.value = "";
            const submitBtn = form.querySelector("button[type='submit']");
            if (submitBtn) submitBtn.textContent = "Generar";
          }
        }

        renderStations();

        addGeneralLogEntry(
          "Baja de estacion",
          `Se eliminó la estación ${st.name} (ID: ${st.id}).`
        );
      });
      actions.appendChild(deleteBtn);
    }

    card.appendChild(header);
    card.appendChild(desc);
    card.appendChild(employeesWrap);

    if (stationsHighlightId && st.id === stationsHighlightId) {
      card.classList.add("is-highlighted");
      highlightedCard = card;
    }

    if (actions.childElementCount) {
      card.appendChild(actions);
    }

    list.appendChild(card);
  });

  if (highlightedCard) {
    try {
      highlightedCard.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {
      // silencioso
    }
  }

  // Actualizar chip de usuarios sin estación en la vista de estaciones
  try {
    const countUnassigned = (adminState.users || []).filter(
      (u) => !u.stationId
    ).length;
    const chip = document.getElementById("stations-users-unassigned");
    if (chip) {
      if (countUnassigned > 0) {
        chip.hidden = false;
        chip.textContent = `Usuarios sin estación: ${countUnassigned}`;
        chip.classList.add("admin-chip-danger-soft");
      } else {
        chip.hidden = true;
      }
    }
  } catch (e) {
    // silencioso
  }
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

  const searchEl = document.getElementById("users-search");
  const roleSelect = document.getElementById("users-filter-role");
  const search = searchEl ? searchEl.value.trim().toLowerCase() : "";
  const roleFilter = roleSelect ? roleSelect.value : "";

  const filtered = adminState.users.filter((user) => {
    if (roleFilter && user.role !== roleFilter) return false;
    if (search) {
      const text = `${user.name || ""} ${user.username || ""}`
        .toLowerCase();
      if (!text.includes(search)) return false;
    }
    return true;
  });

  const total = filtered.length;
  const maxPage = total ? Math.ceil(total / USERS_PAGE_SIZE) : 1;
  if (usersPage > maxPage) {
    usersPage = maxPage;
  }
  if (usersPage < 1) {
    usersPage = 1;
  }

  const start = (usersPage - 1) * USERS_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + USERS_PAGE_SIZE);

  if (!pageItems.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
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

    // Estado (bloqueado / activo)
    const statusTd = document.createElement("td");
    statusTd.textContent = user.locked ? "Bloqueado" : "Activo";
    tr.appendChild(statusTd);

    // Estado de solicitud de cambio de contraseña
    const pwdReqTd = document.createElement("td");
    let pwdStatusLabel = "Sin solicitud";
    if (user.pendingPassword) {
      if (user.pendingPasswordStatus === "aprobada") {
        pwdStatusLabel = "Aprobada";
      } else if (user.pendingPasswordStatus === "rechazada") {
        pwdStatusLabel = "Rechazada";
      } else {
        pwdStatusLabel = "Pendiente";
      }
    }
    pwdReqTd.textContent = pwdStatusLabel;
    tr.appendChild(pwdReqTd);

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

  // Actualizar chip de usuarios sin estación
  try {
    const countUnassigned = (adminState.users || []).filter(
      (u) => !u.stationId
    ).length;
    const chip = document.getElementById("users-unassigned-chip");
    if (chip) {
      if (countUnassigned > 0) {
        chip.hidden = false;
        chip.textContent = `Sin estación asignada: ${countUnassigned}`;
        chip.classList.add("admin-chip-danger-soft");
      } else {
        chip.hidden = true;
      }
    }
  } catch (e) {
    // silencioso
  }
}

function showUserSummary(user) {
  const placeholder = document.getElementById("user-summary-placeholder");
  const body = document.getElementById("user-summary-body");
  const tasksPanel = document.getElementById("user-tasks-panel");
  const tasksTableBody = document.querySelector("#user-tasks-table tbody");
  const quickForm = document.getElementById("user-quick-edit-form");
  const quickRole = document.getElementById("user-quick-role");
  const quickStation = document.getElementById("user-quick-station");
  const quickArea = document.getElementById("user-quick-area");
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

  if (quickForm && quickRole && quickStation && quickArea) {
    quickForm.hidden = false;
    quickForm.dataset.userId = String(user.id);
    quickRole.value = user.role || "";

    quickStation.innerHTML = "";
    const optNone = document.createElement("option");
    optNone.value = "";
    optNone.textContent = "Sin estación";
    quickStation.appendChild(optNone);
    adminState.stations.forEach((st) => {
      const opt = document.createElement("option");
      opt.value = st.id;
      opt.textContent = st.name;
      if (user.stationId === st.id) opt.selected = true;
      quickStation.appendChild(opt);
    });

    quickArea.value = user.area || "";
  }

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
      label: "Estado de cuenta",
      value: user.locked ? "Bloqueado" : "Activo",
    },
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

function exportGeneralLogsCsv() {
  const logs = Array.isArray(adminState.generalLogs)
    ? adminState.generalLogs.slice()
    : [];

  if (!logs.length) {
    showToast(
      "No hay registros en la bitácora general para exportar.",
      "warning"
    );
    return;
  }

  const searchEl = document.getElementById("general-search");
  const search = searchEl
    ? searchEl.value.trim().toLowerCase()
    : "";

  const filtered = logs.filter((log) => {
    const rowText = `${log.user} ${log.activity} ${log.description}`.toLowerCase();
    if (search && !rowText.includes(search)) return false;
    return true;
  });

  if (!filtered.length) {
    showToast(
      "No hay registros en la bitácora general con el filtro actual.",
      "warning"
    );
    return;
  }

  const header = [
    "ID",
    "Usuario",
    "Rol",
    "Actividad",
    "Descripcion",
    "Fecha",
    "Hora",
    "Estado",
  ];

  const rows = filtered.map((log) => [
    log.id || "",
    log.user || "",
    log.role || "",
    log.activity || "",
    log.description || "",
    log.date || "",
    log.time || "",
    log.status || "",
  ]);

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
  a.download = "cog-work-log-bitacora-general.csv";
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

function exportUsersCsv() {
  const users = Array.isArray(adminState.users)
    ? adminState.users.slice()
    : [];

  if (!users.length) {
    showToast("No hay usuarios registrados para exportar.", "warning");
    return;
  }

  const header = [
    "ID",
    "Nombre",
    "Usuario",
    "Rol",
    "Estacion",
    "Area",
    "UltimoCambioContrasena",
    "Bloqueado",
  ];

  const rows = users.map((user) => {
    const station =
      user.stationId &&
      adminState.stations.find((s) => s.id === user.stationId);

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

    return [
      user.id,
      user.name || "",
      user.username || "",
      roleLabel,
      station ? station.name : "",
      user.area || "",
      user.passwordLastChanged || "",
      user.locked ? "SI" : "NO",
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
  a.download = "cog-work-log-usuarios.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast("Usuarios exportados a CSV.", "success");
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

  const dashSecurityViewLogins = document.getElementById(
    "dash-security-view-logins"
  );
  if (dashSecurityViewLogins) {
    dashSecurityViewLogins.addEventListener("click", () => {
      const generalSearch = document.getElementById("general-search");
      if (generalSearch) {
        generalSearch.value = "login";
      }
      // Limitar a eventos de hoy cuando se entra desde este botón
      generalTodayOnly = true;
      const btnToday = document.getElementById("btn-general-today");
      if (btnToday) {
        btnToday.classList.add("is-active");
      }
      setAdminView("general");
      generalPage = 1;
      renderGeneralLogs();
      showToast(
        "Mostrando bitácora general de hoy filtrada por eventos de login.",
        "success"
      );
    });
  }

  const secGotoUsers = document.getElementById("sec-goto-users");
  if (secGotoUsers) {
    secGotoUsers.addEventListener("click", () => {
      setAdminView("users");
    });
  }

  const secGotoLogs = document.getElementById("sec-goto-logs");
  if (secGotoLogs) {
    secGotoLogs.addEventListener("click", () => {
      const searchGeneral = document.getElementById("general-search");
      if (searchGeneral) {
        searchGeneral.value = "";
      }
      generalTodayOnly = false;
      const btnToday = document.getElementById("btn-general-today");
      if (btnToday) {
        btnToday.classList.remove("is-active");
      }
      setAdminView("general");
      generalPage = 1;
      renderGeneralLogs();
      showToast(
        "Mostrando bitácora general para revisar eventos de seguridad.",
        "success"
      );
    });
  }

  const settingsForm = document.getElementById("settings-security-form");
  if (settingsForm) {
    settingsForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!currentUser || currentUser.role !== "admin") {
        showToast(
          "Solo un administrador general puede modificar estas políticas.",
          "error"
        );
        return;
      }

      const maxFailedInput = document.getElementById("settings-max-failed");
      const lockWindowInput = document.getElementById("settings-lock-window");
      const expiryInput = document.getElementById("settings-password-expiry");

      const burstThresholdInput = document.getElementById(
        "settings-alert-burst-threshold"
      );
      const burstWindowInput = document.getElementById(
        "settings-alert-burst-window"
      );
      const criticalToggle = document.getElementById(
        "settings-alert-critical-enabled"
      );
      const burstToggle = document.getElementById(
        "settings-alert-burst-enabled"
      );

      const parsed = getSecuritySettingsFromState();

      if (maxFailedInput) {
        const v = parseInt(maxFailedInput.value, 10);
        if (Number.isFinite(v) && v > 0 && v <= 20) {
          parsed.maxFailedAttempts = v;
        }
      }
      if (lockWindowInput) {
        const v = parseInt(lockWindowInput.value, 10);
        if (Number.isFinite(v) && v > 0 && v <= 120) {
          parsed.lockWindowMinutes = v;
        }
      }
      if (expiryInput) {
        const v = parseInt(expiryInput.value, 10);
        if (Number.isFinite(v) && v > 0 && v <= 365) {
          parsed.passwordExpiryDays = v;
        }
      }

      adminState.securitySettings = parsed;

      const alertParsed = getAlertSettingsFromState();
      if (burstThresholdInput) {
        const v = parseInt(burstThresholdInput.value, 10);
        if (Number.isFinite(v) && v >= 2 && v <= 50) {
          alertParsed.stationBurstThreshold = v;
        }
      }
      if (burstWindowInput) {
        const v = parseInt(burstWindowInput.value, 10);
        if (Number.isFinite(v) && v >= 15 && v <= 720) {
          alertParsed.stationBurstWindowMinutes = v;
        }
      }
      if (criticalToggle) {
        alertParsed.enableCriticalAlerts = !!criticalToggle.checked;
      }
      if (burstToggle) {
        alertParsed.enableStationBurstAlerts = !!burstToggle.checked;
      }

      adminState.alertSettings = alertParsed;
      saveAdminState();
      showToast(
        "Políticas de seguridad y reglas de alertas actualizadas.",
        "success"
      );
    });
  }

  const maintenanceForm = document.getElementById("maintenance-form");
  const maintenanceClear = document.getElementById("maintenance-clear");
  const maintenanceMonth = document.getElementById("maintenance-filter-month");
  const maintenanceStatusFilter = document.getElementById(
    "maintenance-filter-status"
  );

  if (maintenanceForm) {
    maintenanceForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!currentUser || currentUser.role !== "admin") {
        showToast(
          "Solo un administrador general puede gestionar mantenimientos.",
          "error"
        );
        return;
      }

      const idInput = document.getElementById("maintenance-id");
      const stationSelect = document.getElementById("maintenance-station");
      const dateInput = document.getElementById("maintenance-date");
      const typeSelect = document.getElementById("maintenance-type");
      const titleInput = document.getElementById("maintenance-title");
      const statusSelect = document.getElementById("maintenance-status");
      const notesInput = document.getElementById("maintenance-notes");

      if (!stationSelect || !dateInput || !titleInput || !statusSelect) {
        return;
      }

      const stationId = stationSelect.value || "";
      const datePlanned = dateInput.value || "";
      const title = titleInput.value.trim();
      const type = typeSelect ? typeSelect.value || "preventivo" : "preventivo";
      const status = statusSelect.value || "pendiente";
      const notes = notesInput ? notesInput.value.trim() : "";

      if (!stationId || !datePlanned || !title) {
        showToast(
          "Estación, fecha programada y título son obligatorios.",
          "warning"
        );
        return;
      }

      if (!Array.isArray(adminState.maintenance)) {
        adminState.maintenance = [];
      }

      const existingId = idInput && idInput.value ? Number(idInput.value) : 0;
      const nowIso = new Date().toISOString();

      if (existingId) {
        const item = adminState.maintenance.find((m) => m.id === existingId);
        if (item) {
          item.stationId = stationId;
          item.datePlanned = datePlanned;
          item.title = title;
          item.type = type;
          item.status = status;
          item.notes = notes;
          item.updatedAt = nowIso;
        }
      } else {
        const nextId =
          adminState.maintenance.reduce(
            (max, m) => Math.max(max, m.id || 0),
            0
          ) + 1;
        adminState.maintenance.push({
          id: nextId,
          stationId,
          datePlanned,
          title,
          type,
          status,
          notes,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }

      saveAdminState();
      if (idInput) idInput.value = "";
      maintenanceForm.reset();
      hydrateMaintenanceStationSelect();
      renderMaintenanceView();
      showToast("Mantenimiento guardado.", "success");
    });
  }

  if (maintenanceClear) {
    maintenanceClear.addEventListener("click", () => {
      const idInput = document.getElementById("maintenance-id");
      if (idInput) idInput.value = "";
      if (maintenanceForm) maintenanceForm.reset();
      hydrateMaintenanceStationSelect();
    });
  }

  const debouncedRenderMaintenance = debounce(renderMaintenanceView, 180);
  if (maintenanceMonth) {
    maintenanceMonth.addEventListener("change", debouncedRenderMaintenance);
  }
  if (maintenanceStatusFilter) {
    maintenanceStatusFilter.addEventListener(
      "change",
      debouncedRenderMaintenance
    );
  }

  const searchLog = document.getElementById("log-search");
  const debouncedRenderLogs = debounce(renderLogs, 180);
  const debouncedRenderAlerts = debounce(() => {
    alertsPage = 1;
    renderAlerts();
  }, 180);
  const debouncedRenderGeneralLogs = debounce(() => {
    generalPage = 1;
    renderGeneralLogs();
  }, 180);
  const debouncedRenderStations = debounce(renderStations, 180);
  if (searchLog) {
    searchLog.addEventListener("input", debouncedRenderLogs);
  }

  const btnLogsClear = document.getElementById("btn-logs-clear");
  if (btnLogsClear) {
    btnLogsClear.addEventListener("click", () => {
      if (searchLog) searchLog.value = "";
      [
        document.getElementById("log-filter-station"),
        document.getElementById("log-filter-status"),
        document.getElementById("log-filter-frequency"),
        document.getElementById("log-filter-fueltype"),
        document.getElementById("log-filter-from"),
        document.getElementById("log-filter-to"),
        document.getElementById("log-filter-shift"),
      ].forEach((el) => {
        if (!el) return;
        if (el.tagName === "SELECT") el.value = "";
        else if (el.type === "date") el.value = "";
      });

      quickFilterOverdue = false;
      quickFilterIncidents = false;
      quickFilterLast7 = false;
      quickFilterNoFollowUp = false;
      quickFilterFuelDeliveries = false;
      quickFilterEvidence = false;
      quickFilterSentToAdmin = false;
      quickFilterHighSeverity = false;
      quickFilterEvidencePending = false;

      document
        .querySelectorAll(".admin-quick-filters .ghost-btn.is-active")
        .forEach((btn) => btn.classList.remove("is-active"));

      logPage = 1;
      renderLogs();
    });
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

  const btnAlertsClear = document.getElementById("btn-alerts-clear");
  if (btnAlertsClear) {
    btnAlertsClear.addEventListener("click", () => {
      if (alertsSearch) alertsSearch.value = "";
      [
        alertsStation,
        alertsSeverity,
        alertsFrom,
        alertsTo,
        alertsSent,
      ].forEach((el) => {
        if (!el) return;
        if (el.tagName === "SELECT") el.value = "";
        else if (el.type === "date") el.value = "";
        else if (el.type === "checkbox") el.checked = false;
      });

      alertsPage = 1;
      renderAlerts();
    });
  }

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

  const btnGeneralToday = document.getElementById("btn-general-today");
  if (btnGeneralToday) {
    btnGeneralToday.addEventListener("click", () => {
      generalTodayOnly = !generalTodayOnly;
      if (generalTodayOnly) {
        btnGeneralToday.classList.add("is-active");
      } else {
        btnGeneralToday.classList.remove("is-active");
      }
      generalPage = 1;
      renderGeneralLogs();
    });
  }

  const btnGeneralClear = document.getElementById("btn-general-clear");
  if (btnGeneralClear) {
    btnGeneralClear.addEventListener("click", () => {
      if (searchGeneral) searchGeneral.value = "";
      generalTodayOnly = false;
      const todayBtn = document.getElementById("btn-general-today");
      if (todayBtn) todayBtn.classList.remove("is-active");
      generalPage = 1;
      renderGeneralLogs();
    });
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

  const exportGeneralBtn = document.getElementById("btn-export-general-csv");
  if (exportGeneralBtn) {
    exportGeneralBtn.addEventListener("click", () => {
      if (!can("exportLogs")) {
        showToast("No tienes permisos para exportar bitácora.", "error");
        return;
      }
      exportGeneralLogsCsv();
    });
  }

  const exportUsersBtn = document.getElementById("btn-export-users");
  if (exportUsersBtn) {
    if (!can("exportLogs")) {
      exportUsersBtn.style.display = "none";
    } else {
      exportUsersBtn.addEventListener("click", () => {
        if (!can("exportLogs")) {
          showToast("No tienes permisos para exportar usuarios.", "error");
          return;
        }
        exportUsersCsv();
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

  const adminSyncBtn = document.getElementById("admin-sync-btn");
  if (adminSyncBtn) {
    adminSyncBtn.addEventListener("click", async () => {
      adminSyncBtn.disabled = true;
      try {
        await syncAdminStateFromBackendIfAvailable();
        loadAdminState();
        resolveAssignedStationId();
        hydrateLogStationSelect();
        hydrateLogFilterStationSelect();
        hydrateUserStationSelect();
        hydrateDashboardStationSelect();
        renderDashboard();
        renderLogs();
        renderAlerts();
        renderGeneralLogs();
        renderStations();
        renderShifts();
        renderUsers();
        showToast("Datos sincronizados desde el servidor", "success");
      } catch (e) {
        console.error("Error al sincronizar admin-state manualmente", e);
        showToast("No se pudo sincronizar datos desde el servidor", "error");
      } finally {
        adminSyncBtn.disabled = false;
      }
    });
  }

  const alertsPrev = document.getElementById("alerts-page-prev");
  const alertsNext = document.getElementById("alerts-page-next");
  if (alertsPrev) {
    alertsPrev.addEventListener("click", () => {
      if (alertsPage > 1) {
        alertsPage -= 1;
        renderAlerts();
      }
    });
  }
  if (alertsNext) {
    alertsNext.addEventListener("click", () => {
      alertsPage += 1;
      renderAlerts();
    });
  }

  const generalPrev = document.getElementById("general-page-prev");
  const generalNext = document.getElementById("general-page-next");
  if (generalPrev) {
    generalPrev.addEventListener("click", () => {
      if (generalPage > 1) {
        generalPage -= 1;
        renderGeneralLogs();
      }
    });
  }
  if (generalNext) {
    generalNext.addEventListener("click", () => {
      generalPage += 1;
      renderGeneralLogs();
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
      const todayIso = new Date().toISOString().slice(0, 10);

      if (currentUser.role === "admin") {
        // Administradores pueden cambiar su contraseña directamente
        userRecord.password = newPassInput;
        userRecord.passwordLastChanged = todayIso;
      } else {
        // Otros roles: registrar solicitud para aprobación de un administrador
        userRecord.pendingPassword = newPassInput;
        userRecord.pendingPasswordRequestedAt = todayIso;
        userRecord.pendingPasswordStatus = "pendiente";

        showToast(
          "Solicitud de cambio de contraseña enviada. Un administrador debe aprobarla.",
          "success"
        );
      }

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

      // Refrescar vista de usuarios para reflejar la nueva contraseña
      try {
        if (typeof renderUsers === "function") {
          renderUsers();
        }
      } catch (e) {
        console.warn("No se pudo refrescar la tabla de usuarios tras cambio de contraseña", e);
      }

      if (currentUser.role === "admin") {
        showToast("Contraseña actualizada correctamente.");
      }
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

      const newLog = {
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
      };

      adminState.logs.push(newLog);

      saveAdminState();
      // Evaluar reglas de alerta para el nuevo registro
      try {
        createAlertsForLog(newLog);
      } catch (e) {
        // silencioso
      }
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
        const idInput = document.getElementById("station-id");
        const existingId = idInput ? idInput.value.trim() : "";
        const name = document.getElementById("station-name").value.trim();
        const location = document
          .getElementById("station-location")
          .value.trim();
        const desc = document.getElementById("station-desc").value.trim();
        const latStr = document.getElementById("station-lat").value.trim();
        const lngStr = document.getElementById("station-lng").value.trim();
        const yearFromStr = document
          .getElementById("station-year-from")
          .value.trim();
        const yearToStr = document
          .getElementById("station-year-to")
          .value.trim();

        if (!name) return;

        const lat = latStr ? Number(latStr) : null;
        const lng = lngStr ? Number(lngStr) : null;
        const yearFrom = yearFromStr ? Number(yearFromStr) : null;
        const yearTo = yearToStr ? Number(yearToStr) : null;

        let stationId = existingId;
        const isEdit = !!existingId;

        if (isEdit) {
          const st = adminState.stations.find((s) => s.id === existingId);
          if (st) {
            st.name = name;
            st.location = location;
            st.description = desc;
            st.lat = lat;
            st.lng = lng;
            st.yearFrom = yearFrom;
            st.yearTo = yearTo;
          } else {
            stationId = "";
          }
        }

        if (!stationId) {
          stationId = `st${adminState.stations.length + 1}`;
          adminState.stations.push({
            id: stationId,
            name,
            location,
            description: desc,
            employees: [],
            lat,
            lng,
            yearFrom,
            yearTo,
            active: true,
          });
        }

        saveAdminState();

        // Dejar marcada la estación recién creada/actualizada
        stationsHighlightId = stationId;
        stationsEditingId = "";

        if (idInput) idInput.value = "";
        const submitBtn = stationForm.querySelector("button[type='submit']");
        if (submitBtn) submitBtn.textContent = "Generar";

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

        if (isEdit) {
          addGeneralLogEntry(
            "Edicion de estacion",
            `Se actualizó la estación ${name} (ID: ${stationId}).`
          );
        } else {
          addGeneralLogEntry(
            "Alta de estacion",
            `Se creó la estación ${name} (ID: ${stationId}).`
          );
        }
      });
    }
  }

  if (stationClear && can("manageStations")) {
    stationClear.addEventListener("click", () => {
      stationForm.reset();
      stationsEditingId = "";
      stationsHighlightId = "";
      const idInput = document.getElementById("station-id");
      if (idInput) idInput.value = "";
      const submitBtn = stationForm.querySelector("button[type='submit']");
      if (submitBtn) submitBtn.textContent = "Generar";
      document
        .querySelectorAll(".admin-station-card")
        .forEach((c) => c.classList.remove("is-editing", "is-highlighted"));
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

  const usersSearch = document.getElementById("users-search");
  const usersRoleFilter = document.getElementById("users-filter-role");
  if (usersSearch) {
    usersSearch.addEventListener("input", () => {
      usersPage = 1;
      renderUsers();
    });
  }
  if (usersRoleFilter) {
    usersRoleFilter.addEventListener("change", () => {
      usersPage = 1;
      renderUsers();
    });
  }

  const quickForm = document.getElementById("user-quick-edit-form");
  if (quickForm) {
    quickForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const idStr = quickForm.dataset.userId;
      const id = idStr ? Number(idStr) : NaN;
      if (!id || Number.isNaN(id)) {
        showToast("No se pudo identificar al usuario a actualizar.", "error");
        return;
      }

      const user = adminState.users.find((u) => u.id === id);
      if (!user) {
        showToast("El usuario ya no existe en el estado actual.", "error");
        return;
      }

      const roleSel = document.getElementById("user-quick-role");
      const stationSel = document.getElementById("user-quick-station");
      const areaInput = document.getElementById("user-quick-area");

      const newRole = roleSel ? roleSel.value : user.role;
      const newStationId = stationSel ? stationSel.value : user.stationId;
      const newArea = areaInput ? areaInput.value.trim() : user.area;

      user.role = newRole || user.role;
      user.stationId = newStationId || "";
      user.area = newArea;

      saveAdminState();
      renderUsers();
      showUserSummary(user);

      addGeneralLogEntry(
        "Edición rápida de usuario",
        `Se actualizaron rol/estación/área del usuario ${user.username ||
          user.name ||
          ""}.`,
        "ok"
      );

      showToast("Usuario actualizado.", "success");
    });
  }

  const resetUserPwdBtn = document.getElementById(
    "btn-user-reset-password"
  );
  if (resetUserPwdBtn) {
    resetUserPwdBtn.addEventListener("click", () => {
      const selectedRow = document.querySelector(
        "#users-table tbody tr.is-selected"
      );
      if (!selectedRow) {
        showToast(
          "Selecciona un usuario en la tabla para resetear su contraseña.",
          "warning"
        );
        return;
      }

      const idStr = selectedRow.dataset.userId;
      const id = idStr ? Number(idStr) : NaN;
      if (!id || Number.isNaN(id)) {
        showToast("No se pudo identificar al usuario seleccionado.", "error");
        return;
      }

      const user = adminState.users.find((u) => u.id === id);
      if (!user) {
        showToast("No se encontró el usuario en el estado actual.", "error");
        return;
      }

      const base = (user.username || user.name || "user").toLowerCase();
      let simple = base.replace(/[^a-z0-9]/g, "");
      if (!simple) simple = "user";
      const suffix = ("" + (user.id || "")).slice(-3);
      const newPassword = `${simple}_${suffix}`;

      user.password = newPassword;
      user.passwordLastChanged = new Date().toISOString();
      // Si estaba bloqueado, al resetear contraseña también se desbloquea
      user.locked = false;
      user.lockedAt = null;
      saveAdminState();

      // Limpiar intentos de login almacenados para este usuario
      try {
        const rawAttempts = window.localStorage.getItem(LOGIN_ATTEMPTS_KEY);
        if (rawAttempts) {
          const map = JSON.parse(rawAttempts) || {};
          const key = (user.username || "").toLowerCase();
          if (key && map[key]) {
            delete map[key];
            window.localStorage.setItem(
              LOGIN_ATTEMPTS_KEY,
              JSON.stringify(map)
            );
          }
        }
      } catch (e) {
        console.error(
          "No se pudo limpiar el historial de intentos de login tras resetear contraseña",
          e
        );
      }

      renderUsers();

      addGeneralLogEntry(
        "Reset de contraseña",
        `Se reseteó la contraseña del usuario ${user.username ||
          user.name ||
          ""}.`,
        "ok"
      );

      showToast(
        `Contraseña reseteada y cuenta desbloqueada. Nueva contraseña: ${newPassword}`,
        "success"
      );
    });
  }

  const approvePwdBtn = document.getElementById("btn-user-approve-pwd");
  if (approvePwdBtn) {
    approvePwdBtn.addEventListener("click", () => {
      const selectedRow = document.querySelector(
        "#users-table tbody tr.is-selected"
      );
      if (!selectedRow) {
        showToast(
          "Selecciona un usuario que tenga una solicitud de cambio de contraseña.",
          "warning"
        );
        return;
      }

      const idStr = selectedRow.dataset.userId;
      const id = idStr ? Number(idStr) : NaN;
      if (!id || Number.isNaN(id)) {
        showToast("No se pudo identificar al usuario seleccionado.", "error");
        return;
      }

      const user = adminState.users.find((u) => u.id === id);
      if (!user) {
        showToast("No se encontró el usuario en el estado actual.", "error");
        return;
      }

      if (!user.pendingPassword) {
        showToast("El usuario no tiene una solicitud de cambio de contraseña pendiente.", "warning");
        return;
      }

      user.password = user.pendingPassword;
      user.passwordLastChanged = new Date().toISOString().slice(0, 10);
      user.pendingPasswordStatus = "aprobada";
      user.pendingPasswordApprovedAt = new Date().toISOString();
      delete user.pendingPassword;

      saveAdminState();
      renderUsers();

      addGeneralLogEntry(
        "Aprobación de cambio de contraseña",
        `Se aprobó el cambio de contraseña del usuario ${user.username ||
          user.name || ""}.`,
        "ok"
      );

      showToast("Cambio de contraseña aprobado.", "success");
    });
  }

  const rejectPwdBtn = document.getElementById("btn-user-reject-pwd");
  if (rejectPwdBtn) {
    rejectPwdBtn.addEventListener("click", () => {
      const selectedRow = document.querySelector(
        "#users-table tbody tr.is-selected"
      );
      if (!selectedRow) {
        showToast(
          "Selecciona un usuario que tenga una solicitud de cambio de contraseña.",
          "warning"
        );
        return;
      }

      const idStr = selectedRow.dataset.userId;
      const id = idStr ? Number(idStr) : NaN;
      if (!id || Number.isNaN(id)) {
        showToast("No se pudo identificar al usuario seleccionado.", "error");
        return;
      }

      const user = adminState.users.find((u) => u.id === id);
      if (!user) {
        showToast("No se encontró el usuario en el estado actual.", "error");
        return;
      }

      if (!user.pendingPassword) {
        showToast("El usuario no tiene una solicitud de cambio de contraseña pendiente.", "warning");
        return;
      }

      user.pendingPasswordStatus = "rechazada";
      user.pendingPasswordRejectedAt = new Date().toISOString();
      delete user.pendingPassword;

      saveAdminState();
      renderUsers();

      addGeneralLogEntry(
        "Rechazo de cambio de contraseña",
        `Se rechazó la solicitud de cambio de contraseña del usuario ${
          user.username || user.name || ""
        }.`,
        "warning"
      );

      showToast("Solicitud de cambio de contraseña rechazada.", "success");
    });
  }

  const lockUserBtn = document.getElementById("btn-user-lock");
  if (lockUserBtn) {
    lockUserBtn.addEventListener("click", () => {
      const selectedRow = document.querySelector(
        "#users-table tbody tr.is-selected"
      );
      if (!selectedRow) {
        showToast(
          "Selecciona un usuario en la tabla para bloquearlo.",
          "warning"
        );
        return;
      }

      const idStr = selectedRow.dataset.userId;
      const id = idStr ? Number(idStr) : NaN;
      if (!id || Number.isNaN(id)) {
        showToast("No se pudo identificar al usuario seleccionado.", "error");
        return;
      }

      const user = adminState.users.find((u) => u.id === id);
      if (!user) {
        showToast("No se encontró el usuario en el estado actual.", "error");
        return;
      }

      // Proteger al usuario maestro misa de bloqueos manuales
      const uname = (user.username || "").toLowerCase();
      if (uname === "misa" && user.role === "admin") {
        showToast(
          "No puedes bloquear al usuario maestro misa.",
          "warning"
        );
        return;
      }

      if (user.locked) {
        showToast("El usuario ya está bloqueado.", "warning");
        return;
      }

      user.locked = true;
      user.lockedAt = new Date().toISOString();
      saveAdminState();

      // Opcional: limpiar intentos previos para que el estado dependa solo de 'locked'
      try {
        const rawAttempts = window.localStorage.getItem(LOGIN_ATTEMPTS_KEY);
        if (rawAttempts) {
          const map = JSON.parse(rawAttempts) || {};
          const key = uname;
          if (key && map[key]) {
            delete map[key];
            window.localStorage.setItem(
              LOGIN_ATTEMPTS_KEY,
              JSON.stringify(map)
            );
          }
        }
      } catch (e) {
        console.error(
          "No se pudo limpiar el historial de intentos de login del usuario bloqueado manualmente",
          e
        );
      }

      renderUsers();
      showUserSummary(user);

      addGeneralLogEntry(
        "Bloqueo manual de usuario",
        `Se bloqueó manualmente el usuario ${user.username || user.name || ""}.`,
        "warning"
      );

      showToast(
        "Usuario bloqueado. No podrá iniciar sesión hasta ser desbloqueado.",
        "success"
      );
    });
  }

  const unlockUserBtn = document.getElementById("btn-user-unlock");
  if (unlockUserBtn) {
    unlockUserBtn.addEventListener("click", () => {
      const selectedRow = document.querySelector(
        "#users-table tbody tr.is-selected"
      );
      if (!selectedRow) {
        showToast(
          "Selecciona un usuario en la tabla para desbloquearlo.",
          "warning"
        );
        return;
      }

      const idStr = selectedRow.dataset.userId;
      const id = idStr ? Number(idStr) : NaN;
      if (!id || Number.isNaN(id)) {
        showToast("No se pudo identificar al usuario seleccionado.", "error");
        return;
      }

      const user = adminState.users.find((u) => u.id === id);
      if (!user) {
        showToast("No se encontró el usuario en el estado actual.", "error");
        return;
      }

      if (!user.locked) {
        showToast("El usuario no está bloqueado.", "warning");
        return;
      }

      user.locked = false;
      user.lockedAt = null;
      saveAdminState();

      // Limpiar intentos de login almacenados para este usuario
      try {
        const rawAttempts = window.localStorage.getItem(LOGIN_ATTEMPTS_KEY);
        if (rawAttempts) {
          const map = JSON.parse(rawAttempts) || {};
          const key = (user.username || "").toLowerCase();
          if (key && map[key]) {
            delete map[key];
            window.localStorage.setItem(
              LOGIN_ATTEMPTS_KEY,
              JSON.stringify(map)
            );
          }
        }
      } catch (e) {
        console.error(
          "No se pudo limpiar el historial de intentos de login del usuario desbloqueado",
          e
        );
      }

      renderUsers();
      showUserSummary(user);

      addGeneralLogEntry(
        "Desbloqueo de usuario",
        `Se desbloqueó el usuario ${user.username || user.name || ""}.`,
        "ok"
      );

      showToast(
        "Usuario desbloqueado. Ya puede intentar iniciar sesión nuevamente.",
        "success"
      );
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

  // Para creación de registros, solo estaciones activas
  stationsSource = stationsSource.filter((s) => s.active !== false);

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

   // Para nuevos turnos, solo estaciones activas
  stationsSource = stationsSource.filter((s) => s.active !== false);

  stationsSource.forEach((st) => {
    const opt = document.createElement("option");
    opt.value = st.id;
    opt.textContent = st.name;
    select.appendChild(opt);
  });
}

function hydrateMaintenanceStationSelect() {
  const select = document.getElementById("maintenance-station");
  if (!select) return;

  select.innerHTML = "";

  let stationsSource = [...adminState.stations];
  const isStationScoped = currentUser && currentUser.role === "jefe_estacion";
  if (isStationScoped && assignedStationId) {
    stationsSource = stationsSource.filter((s) => s.id === assignedStationId);
  }

  stationsSource = stationsSource.filter((s) => s.active !== false);

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
  const userStats = {};
  const stationStats = {};

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

    const userKey = log.user || "Sin usuario";
    if (!userStats[userKey]) {
      userStats[userKey] = {
        total: 0,
        ok: 0,
        warning: 0,
        error: 0,
        incidents: 0,
      };
    }
    const uStats = userStats[userKey];
    uStats.total += 1;
    if (log.status === "ok") uStats.ok += 1;
    if (log.status === "warning") uStats.warning += 1;
    if (log.status === "error") uStats.error += 1;
    if (log.status === "warning" || log.status === "error") {
      uStats.incidents += 1;
    }

    const stationObjForStats = adminState.stations.find(
      (s) => s.id === log.stationId
    );
    const stationNameKey = stationObjForStats
      ? stationObjForStats.name
      : "Sin estación";
    if (!stationStats[stationNameKey]) {
      stationStats[stationNameKey] = {
        total: 0,
        ok: 0,
        warning: 0,
        error: 0,
        incidents: 0,
      };
    }
    const stStats = stationStats[stationNameKey];
    stStats.total += 1;
    if (log.status === "ok") stStats.ok += 1;
    if (log.status === "warning") stStats.warning += 1;
    if (log.status === "error") stStats.error += 1;
    if (log.status === "warning" || log.status === "error") {
      stStats.incidents += 1;
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
  const comparativeEl = document.getElementById("report-comparative-text");

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

  if (comparativeEl) {
    try {
      const topStation = stationStatsArray
        .slice()
        .sort((a, b) => b.incidents - a.incidents)[0];
      const topUser = userStatsArray
        .slice()
        .sort((a, b) => b.incidents - a.incidents)[0];

      if (!monthValue || (!topStation && !topUser)) {
        comparativeEl.textContent = "";
      } else {
        const stationLabel = topStation
          ? `${topStation.station} (${topStation.incidents} incidentes)`
          : "sin datos";
        const userLabel = topUser
          ? `${topUser.user} (${topUser.incidents} incidentes)`
          : "sin datos";
        comparativeEl.textContent =
          "Mayor incidencia por estación: " +
          stationLabel +
          " · Mayor incidencia por usuario: " +
          userLabel;
      }
    } catch (e) {
      comparativeEl.textContent = "";
    }
  }

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

  const userStatsArray = Object.entries(userStats).map(([user, stats]) => ({
    user,
    total: stats.total,
    ok: stats.ok,
    warning: stats.warning,
    error: stats.error,
    incidents: stats.incidents,
  }));

  const stationStatsArray = Object.entries(stationStats).map(
    ([station, stats]) => ({
      station,
      total: stats.total,
      ok: stats.ok,
      warning: stats.warning,
      error: stats.error,
      incidents: stats.incidents,
    })
  );

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
    userStats: userStatsArray,
    stationStats: stationStatsArray,
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

    const {
      filters,
      rows,
      fuelRows,
      fuelTypeStats,
      totals,
      userStats,
      stationStats,
    } = snapshot;

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

    if (userStats && userStats.length) {
      lines.push("Resumen por usuario (mes seleccionado)");
      lines.push(
        "Usuario,Registros totales,Incidentes,OK,Advertencia,Error"
      );
      userStats.forEach((u) => {
        lines.push(
          [
            `"${u.user}"`,
            u.total,
            u.incidents,
            u.ok,
            u.warning,
            u.error,
          ].join(",")
        );
      });
      lines.push("");
    }

    if (stationStats && stationStats.length) {
      lines.push("Resumen por estacion (mes seleccionado)");
      lines.push(
        "Estacion,Registros totales,Incidentes,OK,Advertencia,Error"
      );
      stationStats.forEach((s) => {
        lines.push(
          [
            `"${s.station}"`,
            s.total,
            s.incidents,
            s.ok,
            s.warning,
            s.error,
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

  // Resumen rápido de coincidencias por tipo
  try {
    const q = query;
    const logs = Array.isArray(adminState.logs) ? adminState.logs : [];
    const users = Array.isArray(adminState.users) ? adminState.users : [];
    const stations = Array.isArray(adminState.stations)
      ? adminState.stations
      : [];
    const general = Array.isArray(adminState.generalLogs)
      ? adminState.generalLogs
      : [];

    const matchesLogs = logs.filter((l) => {
      const txt = `${l.user || ""} ${l.description || ""} ${
        l.incidentType || ""
      }`.toLowerCase();
      return txt.includes(q);
    }).length;

    const matchesUsers = users.filter((u) => {
      const txt = `${u.username || ""} ${u.name || ""} ${
        u.area || ""
      }`.toLowerCase();
      return txt.includes(q);
    }).length;

    const matchesStations = stations.filter((s) => {
      const txt = `${s.name || ""} ${s.location || ""}`.toLowerCase();
      return txt.includes(q);
    }).length;

    const matchesGeneral = general.filter((g) => {
      const txt = `${g.user || ""} ${g.activity || ""} ${
        g.description || ""
      }`.toLowerCase();
      return txt.includes(q);
    }).length;

    const summaryEl = document.getElementById("global-search-summary");
    if (summaryEl) {
      summaryEl.textContent =
        "Coincidencias — Registros: " +
        matchesLogs +
        " · Usuarios: " +
        matchesUsers +
        " · Estaciones: " +
        matchesStations +
        " · Bitácora: " +
        matchesGeneral;
    }
  } catch (e) {
    // silencioso
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

  // Para alta de usuarios, solo estaciones activas
  (adminState.stations || [])
    .filter((st) => st.active !== false)
    .forEach((st) => {
    const opt = document.createElement("option");
    opt.value = st.id;
    opt.textContent = st.name;
    select.appendChild(opt);
  });
}

function getCurrentAdminUserRecord() {
  if (!currentUser) return null;

  const username =
    (currentUser && currentUser.username) ||
    window.localStorage.getItem(`${AUTH_KEY}-username`) ||
    "";

  let user = null;
  if (username) {
    user = adminState.users.find((u) => u.username === username) || null;
  }
  if (!user) {
    user =
      adminState.users.find(
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

// --- Mapa global de estaciones (globo 3D) ---

let stationsGlobeInstance = null;

function buildStationsGlobeData() {
  const points = [];

  (adminState.stations || []).forEach((st) => {
    if (typeof st.lat !== "number" || typeof st.lng !== "number") return;

    const jefe = (adminState.users || []).find(
      (u) => u.role === "jefe_estacion" && u.stationId === st.id
    );

    points.push({
      lat: st.lat,
      lng: st.lng,
      stationId: st.id,
      name: st.name,
      location: st.location || "",
      jefeName: jefe ? jefe.name : "Sin jefe asignado",
      jefeUsername: jefe ? jefe.username : "",
      yearFrom: st.yearFrom || null,
      yearTo: st.yearTo || null,
    });
  });

  return points;
}

function renderStationsGlobeDetails(point) {
  const detailsEl = document.getElementById("stations-globe-details");
  if (!detailsEl || !point) return;

  const years = [];
  if (point.yearFrom) years.push(`Desde ${point.yearFrom}`);
  if (point.yearTo) years.push(`Hasta ${point.yearTo}`);
  const yearsText = years.join(" · ");

  const jefeLabel = point.jefeUsername
    ? `${point.jefeName} (${point.jefeUsername})`
    : point.jefeName;

  detailsEl.dataset.stationId = point.stationId || "";

  detailsEl.innerHTML = `
    <dl class="stations-globe-details">
      <dt>Estación</dt>
      <dd>${point.name}</dd>
      <dt>Ubicación</dt>
      <dd>${point.location || "Sin ubicación"}</dd>
      <dt>Jefe de estación</dt>
      <dd>${jefeLabel}</dd>
      <dt>Operación</dt>
      <dd>${yearsText || "Sin datos de años"}</dd>
      <dt>Coordenadas</dt>
      <dd>${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}</dd>
    </dl>
    <div class="stations-globe-actions">
      <button type="button" class="ghost-btn" data-action="open-station">Ver estación</button>
      <button type="button" class="ghost-btn" data-action="open-logs">Ver bitácora</button>
    </div>
  `;
}

function initStationsGlobe() {
  const container = document.getElementById("stations-globe");
  if (!container) return;
  if (typeof Globe === "undefined") {
    console.warn("Globe.js no está disponible");
    return;
  }

  const data = buildStationsGlobeData();

  if (!stationsGlobeInstance) {
    stationsGlobeInstance = Globe()(container)
      .backgroundColor("rgba(0,0,0,0)")
      .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg")
      .bumpImageUrl("https://unpkg.com/three-globe/example/img/earth-topology.png")
      .showAtmosphere(true)
      .atmosphereColor("#38bdf8")
      .atmosphereAltitude(0.15)
      .pointAltitude(0.02)
      .pointRadius(0.3)
      .pointColor(() => "#22c55e")
      .pointsData(data)
      .pointLat("lat")
      .pointLng("lng")
      .pointLabel((d) => d.name || "Estación");

    stationsGlobeInstance.onPointClick((p) => {
      renderStationsGlobeDetails(p);
    });

    stationsGlobeInstance.pointOfView({ lat: 23, lng: -102, altitude: 2.0 }, 1000);
  } else {
    stationsGlobeInstance.pointsData(data);
  }

  const sidebar = document.getElementById("stations-globe-sidebar");
  if (sidebar && !sidebar.dataset.wired) {
    sidebar.dataset.wired = "1";
    sidebar.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-action]");
      if (!btn) return;

      const detailsEl = document.getElementById("stations-globe-details");
      if (!detailsEl) return;
      const stationId = detailsEl.dataset.stationId || "";
      if (!stationId) return;

      const action = btn.dataset.action;
      if (action === "open-station") {
        stationsHighlightId = stationId;
        setAdminView("stations");
      } else if (action === "open-logs") {
        pendingLogStationFilterId = stationId;
        setAdminView("logs");
      }
    });
  }

  if (!data.length) {
    const detailsEl = document.getElementById("stations-globe-details");
    if (detailsEl) {
      detailsEl.innerHTML =
        '<p class="admin-empty-row-text">No hay estaciones con coordenadas configuradas. Agrega latitud y longitud en el formulario de estaciones.</p>';
    }
  }
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
  const summaryTasksRiskEl = document.getElementById("summary-tasks-risk");
  const fuelRiskEl = document.getElementById("dash-fuel-risk");
  const fuelRiskSubEl = document.getElementById("dash-fuel-risk-sub");
  const shiftsSummaryEl = document.getElementById("dash-shifts-summary");
  const shiftsFuelEl = document.getElementById("dash-shifts-fuel");
  const healthBackendEl = document.getElementById("dash-health-backend");
  const healthAdminSyncEl = document.getElementById("dash-health-admin-sync");
  const healthOpsSyncEl = document.getElementById("dash-health-ops-sync");
  const healthDataSizeEl = document.getElementById("dash-health-data-size");
  const securityLoginFailsEl = document.getElementById(
    "dash-security-login-fails"
  );
  const securityLoginSubEl = document.getElementById(
    "dash-security-login-sub"
  );
  const securityPassExpiredEl = document.getElementById(
    "dash-security-password-expired"
  );
  const securityLoginListEl = document.getElementById(
    "dash-security-login-list"
  );

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
  let riskTasksCount = 0;
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

      // Seleccionar próximas tareas críticas (vencidas, de hoy o de mañana si son alta prioridad)
      criticalTasks = scopedTasks
        .filter(function (t) {
          if (!t || !t.dueDate) return false;
          var pr = (t.priority || "").toLowerCase ? t.priority.toLowerCase() : t.priority;
          var today = new Date();
          var todayMid = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate(),
            0,
            0,
            0,
            0
          );
          var parts = String(t.dueDate).split("-");
          if (parts.length !== 3) return false;
          var due = new Date(
            Number(parts[0]),
            Number(parts[1]) - 1,
            Number(parts[2]),
            0,
            0,
            0,
            0
          );
          if (isNaN(due.getTime())) return false;
          var diffMs = due.getTime() - todayMid.getTime();
          var diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

          var isOverdue = diffDays < 0;
          var isToday = diffDays === 0;
          var isTomorrowHigh = diffDays === 1 && pr === "alta";
          var isHigh = pr === "alta";
          var isRisk = isOverdue || isToday || isTomorrowHigh;
          if (isRisk) {
            riskTasksCount += 1;
          }
          return isOverdue || isToday || isTomorrowHigh || isHigh;
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
  if (summaryTasksRiskEl) {
    const valueSpan = summaryTasksRiskEl.querySelector(".admin-summary-value");
    if (valueSpan) valueSpan.textContent = String(riskTasksCount);
  }

  // Salud del sistema
  if (healthBackendEl) {
    if (adminLastBackendStatus === "online") {
      healthBackendEl.textContent = "Servidor: en línea";
    } else if (adminLastBackendStatus === "offline") {
      healthBackendEl.textContent = "Servidor: sin conexión";
    } else {
      healthBackendEl.textContent = "Servidor: sin comprobar";
    }
  }

  if (healthAdminSyncEl) {
    try {
      const raw = window.localStorage.getItem(ADMIN_LAST_SYNC_KEY);
      if (raw) {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          const dateStr = d.toLocaleDateString("es-MX", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
          const timeStr = d.toLocaleTimeString("es-MX", {
            hour: "2-digit",
            minute: "2-digit",
          });
          healthAdminSyncEl.textContent = `Última sync administración: ${dateStr} ${timeStr}`;
        } else {
          healthAdminSyncEl.textContent = "Última sync administración: nunca";
        }
      } else {
        healthAdminSyncEl.textContent = "Última sync administración: nunca";
      }
    } catch (e) {
      healthAdminSyncEl.textContent = "Última sync administración: -";
    }
  }

  if (healthOpsSyncEl) {
    try {
      const raw = window.localStorage.getItem("cog-work-log-ops-last-sync");
      if (raw) {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          const dateStr = d.toLocaleDateString("es-MX", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
          const timeStr = d.toLocaleTimeString("es-MX", {
            hour: "2-digit",
            minute: "2-digit",
          });
          healthOpsSyncEl.textContent = `Última sync operaciones: ${dateStr} ${timeStr}`;
        } else {
          healthOpsSyncEl.textContent = "Última sync operaciones: nunca";
        }
      } else {
        healthOpsSyncEl.textContent = "Última sync operaciones: nunca";
      }
    } catch (e) {
      healthOpsSyncEl.textContent = "Última sync operaciones: -";
    }
  }

  if (healthDataSizeEl) {
    try {
      const adminRaw = window.localStorage.getItem(ADMIN_STORAGE_KEY) || "";
      const opsRaw = window.localStorage.getItem(OPERATIONS_STORAGE_KEY) || "";
      const totalBytes = adminRaw.length + opsRaw.length;
      const kb = totalBytes / 1024;
      const mb = kb / 1024;
      let label;
      if (mb >= 1) {
        label = `${mb.toFixed(2)} MB`;
      } else {
        label = `${kb.toFixed(1)} KB`;
      }
      healthDataSizeEl.textContent = `Tamaño aproximado de datos: ${label}`;
    } catch (e) {
      healthDataSizeEl.textContent = "Tamaño aproximado de datos: -";
    }
  }

  // Panel rápido de seguridad: intentos de acceso fallidos (últimas 24 h), detalle reciente y contraseñas vencidas
  try {
    if (
      securityLoginFailsEl ||
      securityLoginSubEl ||
      securityPassExpiredEl ||
      securityLoginListEl
    ) {
      const generalLogs = Array.isArray(adminState.generalLogs)
        ? adminState.generalLogs
        : [];
      const now = new Date();
      const thresholdMs = now.getTime() - 24 * 60 * 60 * 1000;
      let failedLoginsLast24h = 0;
      const failedRecent = [];

      generalLogs.forEach((g) => {
        if (!g || !g.date) return;
        const time = g.time || "00:00";
        const dt = new Date(`${g.date}T${time}:00`);
        if (isNaN(dt.getTime()) || dt.getTime() < thresholdMs) return;

        const activity = (g.activity || "").toLowerCase();
        const desc = (g.description || "").toLowerCase();
        const status = (g.status || "").toLowerCase();
        const isLoginRelated =
          activity.indexOf("login") !== -1 ||
          activity.indexOf("inicio de sesión") !== -1 ||
          desc.indexOf("inicio de sesión") !== -1;
        const isFailed = isLoginRelated && status !== "ok";
        if (isFailed) {
          failedLoginsLast24h += 1;
          failedRecent.push({
            date: g.date,
            time: g.time || "",
            user: g.user || "(sin nombre)",
            description: g.description || "",
          });
        }
      });

      if (securityLoginFailsEl) {
        securityLoginFailsEl.textContent = String(failedLoginsLast24h);
      }
      if (securityLoginSubEl) {
        securityLoginSubEl.textContent =
          "Intentos de acceso fallidos (últimas 24 h)";
      }

      if (securityLoginListEl) {
        if (!failedRecent.length) {
          securityLoginListEl.textContent =
            "Sin intentos fallidos recientes registrados.";
        } else {
          failedRecent.sort((a, b) => {
            const aKey = `${a.date || ""}T${a.time || ""}`;
            const bKey = `${b.date || ""}T${b.time || ""}`;
            if (aKey < bKey) return 1;
            if (aKey > bKey) return -1;
            return 0;
          });
          const topItems = failedRecent.slice(0, 4);
          securityLoginListEl.innerHTML = "";
          topItems.forEach((item) => {
            const row = document.createElement("div");
            row.className = "admin-security-list-item";
            const left = document.createElement("span");
            const right = document.createElement("span");
            const whenLabel = item.time
              ? `${formatDateShort(item.date)} · ${item.time}`
              : formatDateShort(item.date);
            left.textContent = `${whenLabel}`;
            right.textContent = item.user;
            row.title = item.description || "";
            row.appendChild(left);
            row.appendChild(right);
            securityLoginListEl.appendChild(row);
          });
        }
      }

      let expiredPasswords = 0;
      const users = Array.isArray(adminState.users) ? adminState.users : [];
      users.forEach((u) => {
        const changedStr = u && u.passwordLastChanged;
        if (!changedStr) {
          expiredPasswords += 1;
          return;
        }
        const changed = new Date(changedStr);
        if (isNaN(changed.getTime())) {
          expiredPasswords += 1;
          return;
        }
        const diffMs = now.getTime() - changed.getTime();
        const days = diffMs / (1000 * 60 * 60 * 24);
        if (days > 90) {
          expiredPasswords += 1;
        }
      });

      if (securityPassExpiredEl) {
        securityPassExpiredEl.textContent = `Contraseñas vencidas: ${expiredPasswords}`;
      }
    }
  } catch (e) {
    console.error("No se pudo calcular resumen de seguridad en dashboard", e);
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

function renderSecurityView() {
  const pendingChip = document.getElementById("sec-pending-passwords-chip");
  const lockedChip = document.getElementById("sec-locked-users-chip");
  const unassignedChip = document.getElementById("sec-unassigned-users-chip");
  const pwdTableBody = document.querySelector("#sec-pwd-table tbody");
  const logTableBody = document.querySelector("#sec-log-table tbody");
  const alertsTableBody = document.querySelector(
    "#sec-alerts-table tbody"
  );

  const users = Array.isArray(adminState.users) ? adminState.users : [];

  const pendingRequests = users.filter((u) => u.pendingPassword);
  const pendingCount = pendingRequests.filter((u) => {
    const st = (u.pendingPasswordStatus || "").toLowerCase();
    return !st || st === "pendiente";
  }).length;
  const lockedCount = users.filter((u) => u.locked).length;
  const unassignedCount = users.filter((u) => !u.stationId).length;

  if (pendingChip) {
    pendingChip.textContent = `Solicitudes de contraseña pendientes: ${pendingCount}`;
    pendingChip.classList.toggle("admin-security-chip-alert", pendingCount > 0);
  }
  if (lockedChip) {
    lockedChip.textContent = `Usuarios bloqueados: ${lockedCount}`;
    lockedChip.classList.toggle("admin-security-chip-alert", lockedCount > 0);
  }
  if (unassignedChip) {
    unassignedChip.textContent = `Usuarios sin estación: ${unassignedCount}`;
    unassignedChip.classList.toggle("admin-security-chip-alert", unassignedCount > 0);
  }

  if (pwdTableBody) {
    pwdTableBody.innerHTML = "";
    if (!pendingRequests.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 4;
      td.className = "admin-empty-row";
      td.textContent = "Sin solicitudes registradas.";
      tr.appendChild(td);
      pwdTableBody.appendChild(tr);
    } else {
      const toRender = pendingRequests
        .slice()
        .sort((a, b) => {
          const ak = a.pendingPasswordRequestedAt || "";
          const bk = b.pendingPasswordRequestedAt || "";
          return ak < bk ? 1 : ak > bk ? -1 : 0;
        });

      toRender.forEach((user) => {
        const tr = document.createElement("tr");

        const usernameTd = document.createElement("td");
        usernameTd.textContent = user.username || "";
        tr.appendChild(usernameTd);

        const roleTd = document.createElement("td");
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
        roleTd.textContent = roleLabel;
        tr.appendChild(roleTd);

        const statusTd = document.createElement("td");
        const st = (user.pendingPasswordStatus || "").toLowerCase();
        if (!st || st === "pendiente") statusTd.textContent = "Pendiente";
        else if (st === "aprobada") statusTd.textContent = "Aprobada";
        else if (st === "rechazada") statusTd.textContent = "Rechazada";
        else statusTd.textContent = user.pendingPasswordStatus || "";
        tr.appendChild(statusTd);

        const requestedTd = document.createElement("td");
        const req = user.pendingPasswordRequestedAt || "";
        requestedTd.textContent = req ? formatDateShort(req.slice(0, 10)) : "-";
        tr.appendChild(requestedTd);

        pwdTableBody.appendChild(tr);
      });
    }
  }

  if (logTableBody) {
    logTableBody.innerHTML = "";
    const allLogs = Array.isArray(adminState.generalLogs)
      ? adminState.generalLogs.slice()
      : [];

    if (!allLogs.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.className = "admin-empty-row";
      td.textContent = "Sin eventos de seguridad registrados.";
      tr.appendChild(td);
      logTableBody.appendChild(tr);
      return;
    }

    const securityLogs = allLogs.filter((g) => {
      const act = (g.activity || "").toLowerCase();
      const desc = (g.description || "").toLowerCase();
      return (
        act.includes("inicio de sesión") ||
        act.includes("login") ||
        act.includes("intento de inicio de sesión") ||
        act.includes("bloqueo") ||
        act.includes("contraseña") ||
        desc.includes("inicio de sesión") ||
        desc.includes("contraseña") ||
        desc.includes("login")
      );
    });

    if (!securityLogs.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.className = "admin-empty-row";
      td.textContent = "Sin eventos de seguridad registrados.";
      tr.appendChild(td);
      logTableBody.appendChild(tr);
      return;
    }

    securityLogs
      .sort((a, b) => {
        const ak = `${a.date || ""}T${a.time || ""}`;
        const bk = `${b.date || ""}T${b.time || ""}`;
        if (ak < bk) return 1;
        if (ak > bk) return -1;
        return 0;
      })
      .slice(0, 40)
      .forEach((log) => {
        const tr = document.createElement("tr");

        const dateTd = document.createElement("td");
        const whenLabel = log.date
          ? `${formatDateShort(log.date)}${log.time ? " · " + log.time : ""}`
          : "-";
        dateTd.textContent = whenLabel;
        tr.appendChild(dateTd);

        const typeTd = document.createElement("td");
        typeTd.textContent = log.activity || "";
        tr.appendChild(typeTd);

        const detailTd = document.createElement("td");
        detailTd.textContent = log.description || "";
        tr.appendChild(detailTd);

        logTableBody.appendChild(tr);
      });
  }

  // Panel de alertas activas
  if (alertsTableBody) {
    alertsTableBody.innerHTML = "";
    const alerts = Array.isArray(adminState.alerts)
      ? adminState.alerts.filter((a) => a && a.status === "activa")
      : [];

    if (!alerts.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.className = "admin-empty-row";
      td.textContent = "Sin alertas activas.";
      tr.appendChild(td);
      alertsTableBody.appendChild(tr);
    } else {
      alerts
        .slice()
        .sort((a, b) => {
          const ak = a.createdAt || "";
          const bk = b.createdAt || "";
          return ak < bk ? 1 : ak > bk ? -1 : 0;
        })
        .forEach((alert) => {
          const tr = document.createElement("tr");

          const whenTd = document.createElement("td");
          const whenIso = alert.createdAt || "";
          const whenDate = whenIso ? whenIso.slice(0, 10) : "";
          whenTd.textContent = whenDate
            ? formatDateShort(whenDate)
            : "-";
          tr.appendChild(whenTd);

          const stationTd = document.createElement("td");
          stationTd.textContent = alert.stationName || "Sin estación";
          tr.appendChild(stationTd);

          const descTd = document.createElement("td");
          descTd.textContent = alert.message || alert.description || "";
          tr.appendChild(descTd);

          const sevTd = document.createElement("td");
          const sevSpan = document.createElement("span");
          sevSpan.className = "badge-priority";
          const sev = (alert.severity || "").toLowerCase();
          if (sev === "alta") {
            sevSpan.classList.add("badge-priority-alta");
            sevSpan.textContent = "Alta";
          } else if (sev === "media") {
            sevSpan.classList.add("badge-priority-media");
            sevSpan.textContent = "Media";
          } else if (sev === "baja") {
            sevSpan.classList.add("badge-priority-baja");
            sevSpan.textContent = "Baja";
          } else {
            sevSpan.textContent = alert.level || "";
          }
          sevTd.appendChild(sevSpan);
          tr.appendChild(sevTd);

          const ruleTd = document.createElement("td");
          if (alert.rule === "critical_incident") {
            ruleTd.textContent = "Incidente crítico";
          } else if (alert.rule === "station_burst") {
            ruleTd.textContent = "Racha de incidentes";
          } else {
            ruleTd.textContent = alert.rule || "";
          }
          tr.appendChild(ruleTd);

          const actionsTd = document.createElement("td");
          const btnResolve = document.createElement("button");
          btnResolve.type = "button";
          btnResolve.className = "ghost-btn";
          btnResolve.textContent = "Marcar atendida";
          btnResolve.addEventListener("click", () => {
            const target = (adminState.alerts || []).find(
              (a) => a && a.id === alert.id
            );
            if (!target) return;
            target.status = "resuelta";
            target.resolvedAt = new Date().toISOString();
            if (currentUser) {
              target.resolvedBy = currentUser.name || "";
            }
            saveAdminState();
            renderSecurityView();
          });
          actionsTd.appendChild(btnResolve);
          tr.appendChild(actionsTd);

          alertsTableBody.appendChild(tr);
        });
    }
  }
}

function renderMaintenanceView() {
  const tbody = document.querySelector("#maintenance-table tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const monthInput = document.getElementById("maintenance-filter-month");
  const statusSelect = document.getElementById("maintenance-filter-status");
  const monthVal = monthInput && monthInput.value ? monthInput.value : "";
  const statusVal = statusSelect ? statusSelect.value : "";

  const year = monthVal ? monthVal.split("-")[0] : "";
  const month = monthVal ? monthVal.split("-")[1] : "";

  const items = Array.isArray(adminState.maintenance)
    ? adminState.maintenance.slice()
    : [];

  const filtered = items.filter((m) => {
    if (!m) return false;
    if (statusVal && m.status !== statusVal) return false;
    if (monthVal && m.datePlanned) {
      const [y, mm] = String(m.datePlanned).split("-");
      if (y !== year || mm !== month) return false;
    }
    return true;
  });

  if (!filtered.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "admin-empty-row";
    td.textContent = monthVal
      ? "Sin mantenimientos programados para el mes seleccionado."
      : "Sin mantenimientos programados.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  filtered
    .sort((a, b) => {
      const ak = `${a.datePlanned || ""}`;
      const bk = `${b.datePlanned || ""}`;
      if (ak < bk) return -1;
      if (ak > bk) return 1;
      return 0;
    })
    .forEach((m) => {
      const tr = document.createElement("tr");

      const dateTd = document.createElement("td");
      dateTd.textContent = m.datePlanned
        ? formatDateShort(m.datePlanned)
        : "-";
      tr.appendChild(dateTd);

      const stationTd = document.createElement("td");
      const st = (adminState.stations || []).find(
        (s) => s.id === m.stationId
      );
      stationTd.textContent = st ? st.name : "Sin estación";
      tr.appendChild(stationTd);

      const typeTd = document.createElement("td");
      typeTd.textContent =
        m.type === "preventivo"
          ? "Preventivo"
          : m.type === "correctivo"
          ? "Correctivo"
          : m.type || "";
      tr.appendChild(typeTd);

      const titleTd = document.createElement("td");
      titleTd.textContent = m.title || "";
      tr.appendChild(titleTd);

      const statusTd = document.createElement("td");
      statusTd.textContent =
        m.status === "pendiente"
          ? "Pendiente"
          : m.status === "en_proceso"
          ? "En progreso"
          : m.status === "completado"
          ? "Completado"
          : m.status === "cancelado"
          ? "Cancelado"
          : m.status || "";
      tr.appendChild(statusTd);

      const actionsTd = document.createElement("td");
      const btnEdit = document.createElement("button");
      btnEdit.type = "button";
      btnEdit.className = "ghost-btn";
      btnEdit.textContent = "Editar";
      btnEdit.addEventListener("click", () => {
        const idInput = document.getElementById("maintenance-id");
        const stationSelect = document.getElementById("maintenance-station");
        const dateInput = document.getElementById("maintenance-date");
        const typeSelect = document.getElementById("maintenance-type");
        const titleInput = document.getElementById("maintenance-title");
        const statusSelect2 = document.getElementById("maintenance-status");
        const notesInput = document.getElementById("maintenance-notes");

        if (!idInput) return;
        idInput.value = String(m.id || "");
        if (stationSelect) stationSelect.value = m.stationId || "";
        if (dateInput) dateInput.value = m.datePlanned || "";
        if (typeSelect) typeSelect.value = m.type || "preventivo";
        if (titleInput) titleInput.value = m.title || "";
        if (statusSelect2) statusSelect2.value = m.status || "pendiente";
        if (notesInput) notesInput.value = m.notes || "";
      });

      const btnDone = document.createElement("button");
      btnDone.type = "button";
      btnDone.className = "ghost-btn";
      btnDone.textContent = "Marcar completado";
      btnDone.addEventListener("click", () => {
        const item = (adminState.maintenance || []).find(
          (x) => x && x.id === m.id
        );
        if (!item) return;
        item.status = "completado";
        item.updatedAt = new Date().toISOString();
        saveAdminState();
        renderMaintenanceView();
      });

      actionsTd.appendChild(btnEdit);
      actionsTd.appendChild(btnDone);
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
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
    updateAdminLastSyncLabel();
    updateAdminConnectionStatusLabel(null);
    checkBackendConnectionStatus();
    if (adminConnectionStatusTimer) {
      clearInterval(adminConnectionStatusTimer);
    }
    adminConnectionStatusTimer = setInterval(
      checkBackendConnectionStatus,
      5 * 60 * 1000
    );
    hydrateLogStationSelect();
    hydrateLogFilterStationSelect();
    hydrateUserStationSelect();
    hydrateDashboardStationSelect();
    if (typeof initActivitiesFilters === "function") {
      initActivitiesFilters();
    }
    setupAdminEvents();
    setupThemeToggle();
    setAdminView("dashboard");

    const userEl = document.querySelector(".admin-topbar-user");
    if (userEl && currentUser) {
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
