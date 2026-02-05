const STORAGE_KEY = "cog-work-log-data";
const THEME_STORAGE_KEY = "cog-work-log-theme";
const ADMIN_STORAGE_KEY = "cog-work-log-admin";
// Configuración opcional de backend para datos operativos
// Usamos misma origen (Render o servidor local que sirve los estáticos y la API)
const BACKEND_URL = "";
const BACKEND_OPERATIONS_ENABLED = true;
// Versión del esquema de datos para poder regenerar datos cuando cambian
// Incrementar este valor cuando se agreguen/ajusten empleados o tareas semilla
const DATA_VERSION = 11;
const TASK_FILTERS_KEY = "cog-work-log-ops-task-filters";
const OPS_LAST_SYNC_KEY = "cog-work-log-ops-last-sync";

const STATUS = {
  PENDING: "pendiente",
  IN_PROGRESS: "en_progreso",
  DONE: "completada",
};

const IDLE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutos
const TASKS_PAGE_SIZE = 50;

let state = {
  employees: [],
  tasks: [],
  selectedEmployeeId: null,
  lastTaskId: 0,
  dataVersion: DATA_VERSION,
};

let currentUser = null;
let employeeCalendar = null;
let currentActivityTaskId = null;
let tasksTodayOnly = false;
let idleTimeoutHandle = null;

let tasksPage = 1;

let currentReassignTaskId = null;
let lastUpdatedTaskId = null;

function resetIdleTimer() {
  if (idleTimeoutHandle) {
    clearTimeout(idleTimeoutHandle);
  }
  idleTimeoutHandle = setTimeout(() => {
    try {
      const user = getCurrentUser();

      // Registrar cierre por inactividad en bitácora general (si existe módulo admin)
      const rawAdmin = window.localStorage.getItem(ADMIN_STORAGE_KEY);
      if (rawAdmin) {
        try {
          const adminData = JSON.parse(rawAdmin) || {};
          const generalLogs = Array.isArray(adminData.generalLogs)
            ? adminData.generalLogs
            : [];
          const nextId =
            generalLogs.reduce((max, l) => Math.max(max, l.id || 0), 0) + 1;
          const now = new Date();
          const date = now.toISOString().slice(0, 10);
          const time = now.toTimeString().slice(0, 5);

          generalLogs.push({
            id: nextId,
            user: user.name || "Usuario",
            role: user.role || "empleado",
            activity: "Cierre de sesión por inactividad",
            description: `Sesión cerrada automáticamente en panel operativo tras inactividad.`,
            date,
            time,
            status: "ok",
          });

          adminData.generalLogs = generalLogs;
          window.localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminData));
        } catch (e) {
          console.error("No se pudo registrar cierre por inactividad (operación)", e);
        }
      }
    } catch (e) {
      console.error("Error en cierre por inactividad (operación)", e);
    }

    if (typeof clearAuth === "function") {
      clearAuth();
    }
    window.location.href = "login.html";
  }, IDLE_TIMEOUT_MS);
}

function updateOperationsLastSyncLabel() {
  try {
    const el = document.getElementById("operations-last-sync");
    if (!el) return;

    const raw = window.localStorage.getItem(OPS_LAST_SYNC_KEY);
    if (!raw) {
      el.textContent = "Sincronizado: nunca";
      return;
    }
    const d = new Date(raw);
    if (isNaN(d.getTime())) {
      el.textContent = "Sincronizado: nunca";
      return;
    }
    const dateStr = d.toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const timeStr = d.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });
    el.textContent = `Sincronizado: ${dateStr} ${timeStr}`;
  } catch (e) {
    console.warn(
      "No se pudo actualizar etiqueta de última sincronización (operaciones)",
      e
    );
  }
}

function setOperationsLastSyncNow() {
  try {
    const nowIso = new Date().toISOString();
    window.localStorage.setItem(OPS_LAST_SYNC_KEY, nowIso);
    updateOperationsLastSyncLabel();
  } catch (e) {
    console.warn("No se pudo guardar última sincronización (operaciones)", e);
  }
}

function setupCrossTabLogoutMain() {
  window.addEventListener("storage", (event) => {
    if (!event) return;
    if (event.key && !event.key.startsWith(AUTH_KEY)) return;
    if (!isAuthenticated()) {
      window.location.href = "login.html";
    }
  });
}

function getChecklistForTemplate(templateKey) {
  const map = {
    apertura: [
      "Verificar extintores y kits de derrame",
      "Revisar conos y señalamientos",
      "Confirmar niveles de tanques dentro de rango",
      "Validar limpieza de islas y accesos",
    ],
    cierre: [
      "Asegurar válvulas y equipos",
      "Registrar niveles finales de tanque",
      "Verificar corte de terminales y arqueos",
      "Revisar cierre de accesos y candados",
    ],
    ronda_seguridad: [
      "Recorrido perimetral de la estación",
      "Verificar alumbrado y cámaras",
      "Revisar presencia de fugas o derrames",
      "Confirmar integridad de cercas y accesos",
    ],
    descarga: [
      "Verificar documentación del autotanque",
      "Colocar barreras y señalamientos",
      "Conectar mangueras y aterrizaje estático",
      "Supervisar niveles durante la descarga",
      "Registrar volúmenes recibidos y novedades",
    ],
  };

  const items = map[templateKey] || [];
  return items.map((label) => ({ label, done: false }));
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

function loadState() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    seedInitialData();
    // asegurar que la versión quede marcada en el primer guardado
    state.dataVersion = DATA_VERSION;
    saveState();
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    // Si la versión guardada es distinta, regenerar completamente los datos demo
    if (!parsed || parsed.dataVersion !== DATA_VERSION) {
      seedInitialData();
      state.dataVersion = DATA_VERSION;
      saveState();
    } else {
      state = { ...state, ...parsed };
    }
  } catch (e) {
    console.error("No se pudo leer localStorage, se usan datos de ejemplo", e);
    seedInitialData();
    state.dataVersion = DATA_VERSION;
    saveState();
  }
}

function saveState() {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      employees: state.employees,
      tasks: state.tasks,
      lastTaskId: state.lastTaskId,
      dataVersion: state.dataVersion || DATA_VERSION,
    })
  );

  // Best-effort: reflejar cambios también en backend si está disponible
  syncOperationsStateToBackendIfAvailable();
}

// Sincronizar estado operativo con el backend si está disponible
async function syncOperationsStateFromBackendIfAvailable() {
  if (!BACKEND_OPERATIONS_ENABLED || typeof fetch === "undefined") {
    return;
  }

  try {
    const resp = await fetch(BACKEND_URL + "/api/operations-state");
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
    state = {
      employees: Array.isArray(backendState.employees)
        ? backendState.employees
        : [],
      tasks: Array.isArray(backendState.tasks) ? backendState.tasks : [],
      selectedEmployeeId: null,
      lastTaskId:
        typeof backendState.lastTaskId === "number"
          ? backendState.lastTaskId
          : 0,
      dataVersion:
        typeof backendState.dataVersion === "number"
          ? backendState.dataVersion
          : DATA_VERSION,
    };

    // Persistir también en localStorage para que el resto del flujo siga igual
    saveState();

    // Marcar última sincronización exitosa
    setOperationsLastSyncNow();
  } catch (e) {
    console.warn("No se pudo sincronizar operaciones desde backend", e);
  }
}

// Enviar estado operativo al backend si está disponible (best-effort)
async function syncOperationsStateToBackendIfAvailable() {
  if (!BACKEND_OPERATIONS_ENABLED || typeof fetch === "undefined") {
    return;
  }

  try {
    await fetch(BACKEND_URL + "/api/operations-state", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state }),
    });
  } catch (e) {
    console.warn("No se pudo enviar operations-state al backend", e);
  }
}


function seedInitialData() {
  // Inicializar sin empleados ni tareas demo; todo se capturará desde cero
  state.employees = [];
  state.tasks = [];
  state.lastTaskId = 0;
}

function getInitials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

// Utilidad simple para evitar recalcular listas pesadas en cada tecla
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

function findEmployee(id) {
  return state.employees.find((e) => e.id === id) || null;
}

function setView(viewId) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.toggle("is-active", v.id === viewId));

  document.querySelectorAll(".nav-item").forEach((btn) => {
    const view = btn.getAttribute("data-view");
    let targetId = null;
    if (view === "dashboard") targetId = "view-dashboard";
    if (view === "myday") targetId = "view-myday";
    if (view === "team") targetId = "view-team";
    if (view === "tasks") targetId = "view-tasks";
    if (view === "profile") targetId = "view-profile";
    btn.classList.toggle("is-active", targetId === viewId);
  });

  if (viewId === "view-dashboard") {
    renderDashboard();
    hydratePipaStationSelect();
    updatePipaSummary();
  }
  if (viewId === "view-myday") {
    renderMyDay();
    hydratePipaStationSelect();
    updateMyDayShiftSummary();
  }
  if (viewId === "view-team") renderTeam();
  if (viewId === "view-employee") renderEmployeeDetail();
  if (viewId === "view-assign") hydrateAssignForm();
  if (viewId === "view-tasks") renderTasksList();
  if (viewId === "view-profile") renderEmployeeProfile();
}

function loadAdminStorageForProfile() {
  const raw = window.localStorage.getItem(ADMIN_STORAGE_KEY);
  if (!raw) {
    return { stations: [], logs: [], generalLogs: [], users: [], shifts: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      stations: parsed.stations || [],
      logs: parsed.logs || [],
      generalLogs: parsed.generalLogs || [],
      users: parsed.users || [],
      shifts: parsed.shifts || [],
    };
  } catch (e) {
    console.warn("No se pudo leer almacenamiento de administración para perfil", e);
    return { stations: [], logs: [], generalLogs: [], users: [], shifts: [] };
  }
}

function hydratePipaStationSelect() {
  const select = document.getElementById("pipa-station");
  if (!select) return;

  const adminData = loadAdminStorageForProfile();
  const stations = Array.isArray(adminData.stations) ? adminData.stations : [];

  select.innerHTML = "";

  if (!stations.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Sin estaciones";
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  stations.forEach((st) => {
    const opt = document.createElement("option");
    opt.value = st.id;
    opt.textContent = st.name;
    select.appendChild(opt);
  });

  // Intentar seleccionar estación del usuario actual (si existe en admin)
  const profile = findCurrentUserRecordForProfile();
  const user = profile && profile.user;
  let initialId = "";
  if (user && user.stationId) {
    const exists = stations.some((s) => s.id === user.stationId);
    if (exists) {
      initialId = user.stationId;
    }
  }

  if (!initialId && stations[0]) {
    initialId = stations[0].id;
  }

  if (initialId) {
    select.value = initialId;
  }

  // Si el usuario está ligado a una sola estación, no permitir cambiarla
  if (user && user.stationId) {
    select.disabled = true;
  } else {
    select.disabled = false;
  }
}

function getLastPipaSummaryText() {
  const profile = findCurrentUserRecordForProfile();
  const adminData = profile && profile.adminData ? profile.adminData : loadAdminStorageForProfile();
  const user = profile && profile.user ? profile.user : null;

  const logs = Array.isArray(adminData.logs) ? adminData.logs : [];
  const stations = Array.isArray(adminData.stations) ? adminData.stations : [];

  let stationId = user && user.stationId ? user.stationId : "";
  if (!stationId) {
    const select = document.getElementById("pipa-station");
    if (select && select.value) stationId = select.value;
  }

  const isFuelLog = (log) => {
    return (
      (log.incidentType && log.incidentType === "Recepción de pipa") ||
      (log.entry &&
        typeof log.entry === "string" &&
        log.entry.indexOf("Recepción de pipa") !== -1)
    );
  };

  const fuelLogs = logs.filter((log) => {
    if (!isFuelLog(log)) return false;
    if (stationId && log.stationId !== stationId) return false;
    return true;
  });

  if (!fuelLogs.length) {
    return "Sin recepciones de pipa registradas aún para tu estación en la bitácora.";
  }

  let lastLog = null;
  let lastKey = "";
  fuelLogs.forEach((log) => {
    if (!log || !log.date) return;
    const key = `${log.date}T${log.time || "00:00"}`;
    if (!lastKey || key > lastKey) {
      lastKey = key;
      lastLog = log;
    }
  });

  if (!lastLog || !lastLog.date) {
    return "Sin recepciones de pipa registradas aún para tu estación en la bitácora.";
  }

  const station = stations.find((s) => s.id === (lastLog.stationId || stationId));
  const stationName = station ? station.name : "Estación";
  const fuelType = lastLog.fuelType || "Combustible";
  const litersValue =
    typeof lastLog.fuelLiters === "number" && !isNaN(lastLog.fuelLiters)
      ? lastLog.fuelLiters
      : null;

  const todayIso = new Date().toISOString().slice(0, 10);
  let daysSince = null;
  try {
    const lastDate = new Date(lastLog.date + "T00:00:00");
    const nowDate = new Date(todayIso + "T00:00:00");
    const diffMs = nowDate.getTime() - lastDate.getTime();
    daysSince = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  } catch (e) {
    daysSince = null;
  }

  const dateLabel =
    typeof formatDateShort === "function"
      ? formatDateShort(lastLog.date)
      : lastLog.date;

  const parts = [];
  parts.push(`${stationName}: ${fuelType}`);
  if (litersValue != null) {
    parts.push(`${litersValue.toLocaleString("es-MX")} L`);
  }
  parts.push(`el ${dateLabel}`);
  if (daysSince != null) {
    parts.push(
      `(${daysSince} día${daysSince === 1 ? "" : "s"} desde entonces)`
    );
  }

  return "Última recepción registrada: " + parts.join(" · ");
}

function updatePipaSummary() {
  const summaryEl = document.getElementById("pipa-summary-body");
  if (!summaryEl) return;
  summaryEl.textContent = getLastPipaSummaryText();
}

function updateMyDayShiftSummary() {
  const summaryEl = document.getElementById("myday-pipa-summary-body");
  if (!summaryEl) return;
  summaryEl.textContent = getLastPipaSummaryText();
}

function findCurrentUserRecordForProfile() {
  if (!currentUser) return { adminData: loadAdminStorageForProfile(), user: null };

  const adminData = loadAdminStorageForProfile();
  const username =
    (currentUser && currentUser.username) ||
    window.localStorage.getItem(`${AUTH_KEY}-username`) ||
    "";

  let user = null;
  if (username) {
    user = adminData.users.find((u) => u.username === username) || null;
  }
  if (!user) {
    user =
      adminData.users.find(
        (u) => u.name === currentUser.name && u.role === currentUser.role
      ) || null;
  }

  return { adminData, user };
}

function renderEmployeeProfile() {
  if (!currentUser) return;

  const { adminData, user } = findCurrentUserRecordForProfile();

  const avatarEl = document.getElementById("emp-profile-avatar");
  const nameEl = document.getElementById("emp-profile-name");
  const roleLabelEl = document.getElementById("emp-profile-role");
  const stationEl = document.getElementById("emp-profile-station");
  const lastLoginEl = document.getElementById("emp-profile-last-login");

  const fullNameInput = document.getElementById("emp-profile-fullname");
  const usernameInput = document.getElementById("emp-profile-username");
  const roleInput = document.getElementById("emp-profile-role-input");
  const areaInput = document.getElementById("emp-profile-area");
  const positionInput = document.getElementById("emp-profile-position");
  const rfcInput = document.getElementById("emp-profile-rfc");
  const stationRfcInput = document.getElementById("emp-profile-station-rfc");
  const emailInput = document.getElementById("emp-profile-email");
  const phoneInput = document.getElementById("emp-profile-phone");
  const photoInput = document.getElementById("emp-profile-photo");

  const displayName = (user && user.name) || currentUser.name;

  let roleLabel = "Operador";
  if (currentUser.role === "admin") roleLabel = "Administrador";
  else if (currentUser.role === "jefe_estacion") roleLabel = "Jefe de estación";
  else if (currentUser.role === "auditor") roleLabel = "Auditor";

  let stationLabel = "-";
  const emp = state.employees.find(
    (e) => e.name.toLowerCase() === currentUser.name.toLowerCase()
  );
  if (emp && emp.station) stationLabel = emp.station;

  if (avatarEl) {
    avatarEl.textContent = getInitials(displayName || "U");
    avatarEl.style.backgroundImage = "";
    if (user && user.photoUrl) {
      avatarEl.style.backgroundImage = `url(${user.photoUrl})`;
      avatarEl.style.backgroundSize = "cover";
      avatarEl.style.backgroundPosition = "center";
      avatarEl.textContent = "";
    }
  }

  if (nameEl) nameEl.textContent = displayName;
  if (roleLabelEl) roleLabelEl.textContent = roleLabel;
  if (stationEl) stationEl.textContent = `Estación: ${stationLabel}`;

  if (lastLoginEl && Array.isArray(adminData.generalLogs)) {
    let last = null;
    const targetName = displayName;
    for (let i = adminData.generalLogs.length - 1; i >= 0; i -= 1) {
      const log = adminData.generalLogs[i];
      if (!log) continue;
      if (log.activity !== "Inicio de sesión") continue;
      if (log.user !== targetName) continue;
      last = log;
      break;
    }

    if (last && last.date && last.time) {
      lastLoginEl.textContent = `Último acceso: ${formatDateShort(
        last.date
      )} ${last.time}`;
    } else if (last && last.date) {
      lastLoginEl.textContent = `Último acceso: ${formatDateShort(
        last.date
      )}`;
    } else {
      lastLoginEl.textContent = "Último acceso: -";
    }
  }

  if (fullNameInput) fullNameInput.value = displayName || "";
  if (usernameInput)
    usernameInput.value = (user && user.username) || currentUser.username || "";
  if (roleInput) roleInput.value = roleLabel;
  if (areaInput)
    areaInput.value = (user && user.area) || currentUser.area || "";
  if (positionInput)
    positionInput.value = (user && user.position) || "";
  if (rfcInput) rfcInput.value = (user && user.rfc) || "";
  if (stationRfcInput)
    stationRfcInput.value = (user && user.stationRfc) || "";
  if (emailInput) emailInput.value = (user && user.email) || "";
  if (phoneInput) phoneInput.value = (user && user.phone) || "";
  if (photoInput) photoInput.value = (user && user.photoUrl) || "";
}

function renderDashboard() {
  let employeesSource = [...state.employees];
  let tasksSource = [...state.tasks];
  if (currentUser) {
    if (currentUser.role === "empleado") {
      let scopedIds = [];
      if (state.selectedEmployeeId) {
        scopedIds = [state.selectedEmployeeId];
      } else {
        scopedIds = state.employees
          .filter(
            (e) => e.name && e.name.toLowerCase() === currentUser.name.toLowerCase()
          )
          .map((e) => e.id);
      }

      if (scopedIds.length) {
        const idSet = new Set(scopedIds);
        employeesSource = employeesSource.filter((e) => idSet.has(e.id));
        tasksSource = tasksSource.filter((t) => idSet.has(t.employeeId));
      } else {
        employeesSource = [];
        tasksSource = [];
      }
    }
  }

  const totalEmployees = employeesSource.length;
  const pending = tasksSource.filter((t) => t.status === STATUS.PENDING).length;
  const inProgress = tasksSource.filter((t) => t.status === STATUS.IN_PROGRESS).length;
  const done = tasksSource.filter((t) => t.status === STATUS.DONE).length;
  const overdue = tasksSource.filter(
    (t) => isTaskPastDue(t.dueDate) && t.status !== STATUS.DONE
  ).length;
  const riskCount = tasksSource.filter((t) => isTaskAtRisk(t)).length;

  document.getElementById("stat-total-employees").textContent = String(totalEmployees);
  document.getElementById("stat-pending-tasks").textContent = String(pending);
  document.getElementById("stat-inprogress-tasks").textContent = String(inProgress);
  document.getElementById("stat-completed-tasks").textContent = String(done);
  const overdueEl = document.getElementById("stat-overdue-tasks");
  if (overdueEl) overdueEl.textContent = String(overdue);
  const riskEl = document.getElementById("stat-risk-tasks");
  if (riskEl) riskEl.textContent = String(riskCount);

  // Actualizar resumen personal en topbar
  const myPendingEl = document.getElementById("topbar-my-pending");
  const myOverdueEl = document.getElementById("topbar-my-overdue");

  let myPending = pending;
  let myOverdue = overdue;

  if (currentUser && currentUser.role === "empleado" && state.selectedEmployeeId) {
    const myTasks = state.tasks.filter((t) => t.employeeId === state.selectedEmployeeId);
    myPending = myTasks.filter((t) => t.status === STATUS.PENDING).length;
    myOverdue = myTasks.filter(
      (t) => isTaskPastDue(t.dueDate) && t.status !== STATUS.DONE
    ).length;
  }

  if (myPendingEl) myPendingEl.textContent = `Pendientes: ${myPending}`;
  if (myOverdueEl) myOverdueEl.textContent = `Atrasadas: ${myOverdue}`;

  const container = document.getElementById("dashboard-team-list");
  container.innerHTML = "";

  employeesSource.slice(0, 4).forEach((emp) => {
    const card = createEmployeeCard(emp);
    container.appendChild(card);
  });

  const criticalContainer = document.getElementById("dashboard-critical-list");
  if (criticalContainer) {
    criticalContainer.innerHTML = "";

    const todayStr = new Date().toISOString().slice(0, 10);
    const candidates = tasksSource.filter(
      (t) => t.status !== STATUS.DONE
    );

    const critical = candidates.filter((t) => {
      const cat = getTaskDueCategory(t);
      const priority = (t.priority || "").toLowerCase();
      const isHigh = priority === "alta";
      const isOverdue = cat === "overdue";
      const isToday = cat === "today";
      const isTomorrowAndHigh = cat === "tomorrow" && isHigh;
      return isOverdue || isToday || isTomorrowAndHigh || isHigh;
    });

    critical.sort((a, b) => {
      const aDate = a.dueDate || todayStr;
      const bDate = b.dueDate || todayStr;
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      const aTime = a.dueTime || "23:59";
      const bTime = b.dueTime || "23:59";
      if (aTime !== bTime) return aTime.localeCompare(bTime);
      const aHigh = (a.priority || "").toLowerCase() === "alta" ? 0 : 1;
      const bHigh = (b.priority || "").toLowerCase() === "alta" ? 0 : 1;
      return aHigh - bHigh;
    });

    const top = critical.slice(0, 4);

    if (!top.length) {
      criticalContainer.textContent =
        "Sin tareas críticas registradas para tu equipo.";
    } else {
      top.forEach((task) => {
        const item = document.createElement("div");
        item.className = "admin-security-list-item";

        const left = document.createElement("span");
        const dueLabel = task.dueDate
          ? formatDate(task.dueDate)
          : "Sin fecha";
        const timeLabel = task.dueTime || "";
        left.textContent = timeLabel
          ? `${dueLabel} · ${timeLabel}`
          : dueLabel;

        const right = document.createElement("span");
        right.textContent = task.title || "Tarea";

        const employee = state.employees.find(
          (e) => e.id === task.employeeId
        );
        const empName = employee ? employee.name : "Operador";
        right.title = timeLabel
          ? `${empName} · ${dueLabel} ${timeLabel}`
          : `${empName} · ${dueLabel}`;

        item.appendChild(left);
        item.appendChild(right);
        criticalContainer.appendChild(item);
      });
    }
  }

  if (employeeCalendar) {
    refreshEmployeeCalendarEvents();
  }
}

function renderMyDay() {
  const todayStr = new Date().toISOString().slice(0, 10);

  let employeesSource = [...state.employees];
  let tasksSource = state.tasks.filter((t) => t.dueDate === todayStr);

  if (currentUser) {
    if (currentUser.role === "empleado") {
      let scopedIds = [];
      if (state.selectedEmployeeId) {
        scopedIds = [state.selectedEmployeeId];
      } else {
        scopedIds = state.employees
          .filter(
            (e) => e.name && e.name.toLowerCase() === currentUser.name.toLowerCase()
          )
          .map((e) => e.id);
      }

      if (scopedIds.length) {
        const idSet = new Set(scopedIds);
        employeesSource = employeesSource.filter((e) => idSet.has(e.id));
        tasksSource = tasksSource.filter((t) => idSet.has(t.employeeId));
      } else {
        employeesSource = [];
        tasksSource = [];
      }
    }
  }

  const total = tasksSource.length;
  const pending = tasksSource.filter((t) => t.status === STATUS.PENDING).length;
  const inProgress = tasksSource.filter((t) => t.status === STATUS.IN_PROGRESS).length;
  const done = tasksSource.filter((t) => t.status === STATUS.DONE).length;
  const overdue = tasksSource.filter(
    (t) => isTaskPastDue(t.dueDate) && t.status !== STATUS.DONE
  ).length;

  const totalEl = document.getElementById("myday-total");
  const pendingEl = document.getElementById("myday-pending");
  const inProgressEl = document.getElementById("myday-inprogress");
  const doneEl = document.getElementById("myday-done");
  const overdueEl = document.getElementById("myday-overdue");

  if (totalEl) totalEl.textContent = String(total);
  if (pendingEl) pendingEl.textContent = String(pending);
  if (inProgressEl) inProgressEl.textContent = String(inProgress);
  if (doneEl) doneEl.textContent = String(done);
  if (overdueEl) overdueEl.textContent = String(overdue);

  const tbody = document.querySelector("#myday-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const sorted = [...tasksSource].sort((a, b) => {
    const at = a.dueTime || "";
    const bt = b.dueTime || "";
    return at.localeCompare(bt);
  });

  if (!sorted.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "table-empty-row";
    td.textContent = "Sin tareas programadas para hoy.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  sorted.forEach((t) => {
    const tr = document.createElement("tr");
    tr.dataset.taskId = String(t.id);

    if (t.id === lastUpdatedTaskId) {
      tr.classList.add("task-row-flash");
    }

    const emp = findEmployee(t.employeeId);

    const timeTd = document.createElement("td");
    timeTd.textContent = t.dueTime || "-";

    const titleTd = document.createElement("td");
    titleTd.textContent = emp ? `${t.title} · ${emp.name}` : t.title;

    const freqTd = document.createElement("td");
    freqTd.appendChild(createFrequencyBadge(t.frequency || "unica"));

    const priorityTd = document.createElement("td");
    const prioritySpan = document.createElement("span");
    const priority = t.priority || "media";
    prioritySpan.textContent =
      priority === "alta" ? "Alta" : priority === "baja" ? "Baja" : "Media";
    prioritySpan.className = "badge-priority badge-priority-" + priority;
    priorityTd.appendChild(prioritySpan);

    const statusTd = document.createElement("td");
    statusTd.appendChild(createStatusBadge(t.status));

    tr.appendChild(timeTd);
    tr.appendChild(titleTd);
    tr.appendChild(freqTd);
    tr.appendChild(priorityTd);
    tr.appendChild(statusTd);

    tbody.appendChild(tr);
  });
}

function registerFuelDeliveryFromForm() {
  const stationSelect = document.getElementById("pipa-station");
  const fuelTypeSelect = document.getElementById("pipa-fuel-type");
  const litersInput = document.getElementById("pipa-liters");
  const startTimeInput = document.getElementById("pipa-start-time");
  const endTimeInput = document.getElementById("pipa-end-time");
  const unitInput = document.getElementById("pipa-unit");
  const supplierInput = document.getElementById("pipa-supplier");
  const docUrlInput = document.getElementById("pipa-doc-url");
  const ticketUrlInput = document.getElementById("pipa-ticket-url");
  const notesInput = document.getElementById("pipa-notes");

  if (!stationSelect || !fuelTypeSelect || !litersInput) return;

  const stationId = stationSelect.value;
  const fuelType = fuelTypeSelect.value;
  const liters = parseFloat(litersInput.value || "0");
  const startTime = startTimeInput ? startTimeInput.value : "";
  const endTime = endTimeInput ? endTimeInput.value : "";
  const unit = unitInput ? unitInput.value.trim() : "";
  const supplier = supplierInput ? supplierInput.value.trim() : "";
  const docUrl = docUrlInput ? docUrlInput.value.trim() : "";
  const ticketUrl = ticketUrlInput ? ticketUrlInput.value.trim() : "";
  const notes = notesInput ? notesInput.value.trim() : "";

  if (!stationId || !fuelType || !(liters > 0) || !startTime || !endTime) {
    showToast(
      "Estación, tipo de combustible, litros y horario son obligatorios.",
      "warning"
    );
    return;
  }

  try {
    const rawAdmin = window.localStorage.getItem(ADMIN_STORAGE_KEY);
    let adminData = rawAdmin ? JSON.parse(rawAdmin) : {};

    const logs = Array.isArray(adminData.logs) ? adminData.logs : [];
    const stations = Array.isArray(adminData.stations) ? adminData.stations : [];

    const nextId =
      logs.reduce((max, l) => Math.max(max, l.id || 0), 0) + 1;

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const timeNow = now.toTimeString().slice(0, 5);

    const station = stations.find((s) => s.id === stationId) || null;
    const stationName = station ? station.name : stationId;

    const userInfo =
      typeof getCurrentUser === "function" ? getCurrentUser() : currentUser;
    const userName = userInfo && userInfo.name ? userInfo.name : "Operación";
    const username = userInfo && userInfo.username ? userInfo.username : "";
    const role = userInfo && userInfo.role ? userInfo.role : "empleado";

    const fuelLabel =
      fuelType === "magna"
        ? "Magna"
        : fuelType === "premium"
        ? "Premium"
        : fuelType === "diesel"
        ? "Diésel"
        : "Otro";

    const shiftFromTime = (t) => {
      if (!t || typeof t !== "string") return "matutino";
      const parts = t.split(":");
      const h = parseInt(parts[0], 10);
      if (isNaN(h)) return "matutino";
      if (h < 14) return "matutino";
      if (h < 22) return "vespertino";
      return "nocturno";
    };

    const shift = shiftFromTime(startTime || timeNow);

    const descriptionParts = [];
    descriptionParts.push(
      "Recepción de pipa de " + fuelLabel + " por " + liters + " litros."
    );
    descriptionParts.push(
      "Horario de descarga: " +
        (startTime || "--:--") +
        " a " +
        (endTime || "--:--") +
        "."
    );
    if (unit) {
      descriptionParts.push("Unidad / pipa: " + unit + ".");
    }
    if (supplier) {
      descriptionParts.push("Proveedor: " + supplier + ".");
    }
    if (notes) {
      descriptionParts.push("Observaciones: " + notes);
    }

    const description = descriptionParts.join(" ");

    // Validaciones adicionales básicas
    if (startTime && endTime && startTime > endTime) {
      showToast(
        "La hora de inicio no puede ser mayor que la hora de fin.",
        "warning"
      );
      return;
    }

    if (liters < 5000 || liters > 40000) {
      const proceed = window.confirm(
        "Los litros capturados están fuera del rango típico (5,000 - 40,000 L). ¿Deseas continuar?"
      );
      if (!proceed) {
        return;
      }
    }

    logs.push({
      id: nextId,
      stationId,
      user: userName,
      entry: "Recepción de pipa/autotanque",
      description,
      date,
      time: startTime || timeNow,
      status: "ok",
      frequency: "unica",
      shift,
      incidentType: "Recepción de pipa",
      severity: "baja",
      manualUrl: docUrl,
      evidenceUrl: ticketUrl,
      fuelType: fuelLabel,
      fuelLiters: liters,
      createdAt: now.toISOString(),
      createdByName: userName,
      createdByUsername: username,
      createdByRole: role,
      approvalStatus: "",
      sentToAdmin: true,
      fuelReviewStatus: "registrada",
    });

    adminData.logs = logs;
    if (!adminData.stations) adminData.stations = stations;
    window.localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminData));

    showToast(
      "Recepción de pipa registrada para " + stationName + ".",
      "success"
    );

    updatePipaSummary();

    const form = document.getElementById("pipa-form");
    if (form) {
      if (!(document.getElementById("pipa-station") || {}).disabled) {
        form.reset();
      } else {
        const currentStationId = stationSelect ? stationSelect.value : "";
        form.reset();
        const selectAfter = document.getElementById("pipa-station");
        if (selectAfter && currentStationId) {
          selectAfter.value = currentStationId;
        }
      }
    }
  } catch (e) {
    console.error("No se pudo registrar la recepción de pipa", e);
    showToast(
      "No se pudo registrar la recepción de pipa. Intente nuevamente.",
      "error"
    );
  }
}

function getTasksForExport() {
  const selectEmployee = document.getElementById("filter-employee");
  const selectStation = document.getElementById("filter-station");

  const search = document.getElementById("tasks-search").value.trim().toLowerCase();
  const filterStatus = document.getElementById("filter-status").value;
  const riskCheckbox = document.getElementById("filter-risk-only");
  const riskOnly = riskCheckbox ? !!riskCheckbox.checked : false;

  let filtered = [...state.tasks];
  if (currentUser) {
    if (currentUser.role === "empleado") {
      let scopedIds = [];
      if (state.selectedEmployeeId) {
        scopedIds = [state.selectedEmployeeId];
      } else {
        scopedIds = state.employees
          .filter(
            (e) => e.name && e.name.toLowerCase() === currentUser.name.toLowerCase()
          )
          .map((e) => e.id);
      }
      if (scopedIds.length) {
        const idSet = new Set(scopedIds);
        filtered = filtered.filter((t) => idSet.has(t.employeeId));
      } else {
        filtered = [];
      }
    }
  }

  if (selectEmployee && selectEmployee.value) {
    filtered = filtered.filter((t) => t.employeeId === selectEmployee.value);
  }
  if (selectStation && selectStation.value) {
    filtered = filtered.filter((t) => t.station === selectStation.value);
  }
  if (filterStatus) {
    filtered = filtered.filter((t) => t.status === filterStatus);
  }
  if (search) {
    filtered = filtered.filter((t) => {
      const emp = findEmployee(t.employeeId);
      const empName = emp ? emp.name.toLowerCase() : "";
      return (
        t.title.toLowerCase().includes(search) || empName.includes(search)
      );
    });
  }

  const dateRangeSelect = document.getElementById("filter-date-range");
  const dateRange = dateRangeSelect ? dateRangeSelect.value : "";

  // Guardar filtros actuales para futuras sesiones
  try {
    const filtersSnapshot = {
      employeeId: selectEmployee ? selectEmployee.value : "",
      station: selectStation ? selectStation.value : "",
      status: filterStatus || "",
      search,
      dateRange,
      riskOnly: !!riskOnly,
      todayOnly: !!tasksTodayOnly,
    };
    window.localStorage.setItem(
      TASK_FILTERS_KEY,
      JSON.stringify(filtersSnapshot)
    );
  } catch (e) {
    // silencioso
  }

  if (dateRange) {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    if (dateRange === "today") {
      filtered = filtered.filter((t) => t.dueDate === todayStr);
    } else if (dateRange === "7" || dateRange === "30") {
      const limit = new Date(today);
      limit.setDate(limit.getDate() + (dateRange === "7" ? 7 : 30));
      const limitStr = limit.toISOString().slice(0, 10);
      filtered = filtered.filter(
        (t) =>
          t.dueDate && t.dueDate >= todayStr && t.dueDate <= limitStr
      );
    } else if (dateRange === "overdue") {
      filtered = filtered.filter(
        (t) =>
          t.dueDate &&
          t.dueDate < todayStr &&
          t.status !== STATUS.DONE
      );
    }
  } else if (tasksTodayOnly) {
    const todayStr = new Date().toISOString().slice(0, 10);
    filtered = filtered.filter((t) => t.dueDate === todayStr);
  }

  if (riskOnly) {
    filtered = filtered.filter((t) => isTaskAtRisk(t));
  }

  filtered.sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
  return filtered;
}

function exportTasksCsv() {
  const tasks = getTasksForExport();
  if (!tasks.length) {
    showToast("No hay tareas para exportar con los filtros actuales.", "warning");
    return;
  }

  const header = [
    "ID",
    "Operador",
    "Tarea",
    "Fecha limite",
    "Hora",
    "Frecuencia",
    "Prioridad",
    "Estado",
    "Estacion",
  ];

  const rows = tasks.map((t) => {
    const emp = findEmployee(t.employeeId);
    return [
      t.id,
      emp ? emp.name : "",
      t.title,
      t.dueDate || "",
      t.dueTime || "",
      t.frequency || "unica",
      t.priority || "media",
      t.status || "",
      t.station || "",
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
  a.download = "tareas.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Exportación CSV de tareas generada", "success");
}

function renderTeam() {
  const container = document.getElementById("team-list");
  container.innerHTML = "";

  let employeesSource = [...state.employees];
  if (currentUser) {
    if (currentUser.role === "empleado") {
      let scopedIds = [];
      if (state.selectedEmployeeId) {
        scopedIds = [state.selectedEmployeeId];
      } else {
        scopedIds = state.employees
          .filter(
            (e) => e.name && e.name.toLowerCase() === currentUser.name.toLowerCase()
          )
          .map((e) => e.id);
      }
      if (scopedIds.length) {
        const idSet = new Set(scopedIds);
        employeesSource = employeesSource.filter((e) => idSet.has(e.id));
      } else {
        employeesSource = [];
      }
    }
  }

  employeesSource.forEach((emp) => {
    const card = createEmployeeCard(emp);
    container.appendChild(card);
  });
}

function createEmployeeCard(emp) {
  const wrapper = document.createElement("article");
  wrapper.className = "employee-card";

  const main = document.createElement("div");
  main.className = "employee-main";

  const avatar = document.createElement("div");
  avatar.className = "employee-avatar";
  avatar.textContent = getInitials(emp.name);

  const textWrap = document.createElement("div");
  const title = document.createElement("div");
  title.className = "employee-text-main";
  title.textContent = emp.name;
  const sub = document.createElement("div");
  sub.className = "employee-text-sub";
  sub.textContent = `${emp.role} · ${emp.station}`;

  textWrap.appendChild(title);
  textWrap.appendChild(sub);

  main.appendChild(avatar);
  main.appendChild(textWrap);

  const btn = document.createElement("button");
  btn.className = "primary-btn";
  btn.type = "button";
  btn.textContent = "Ver detalles";
  btn.addEventListener("click", () => {
    state.selectedEmployeeId = emp.id;
    setView("view-employee");
  });

  wrapper.appendChild(main);
  wrapper.appendChild(btn);
  return wrapper;
}

function renderEmployeeDetail() {
  const emp = findEmployee(state.selectedEmployeeId) || state.employees[0];
  if (!emp) return;

  state.selectedEmployeeId = emp.id;

  const avatar = document.getElementById("employee-avatar");
  avatar.textContent = getInitials(emp.name);

  document.getElementById("employee-name").textContent = emp.name;
  document.getElementById(
    "employee-meta"
  ).textContent = `${emp.role} · ${emp.station}`;

  const tbody = document.querySelector("#employee-tasks-table tbody");
  tbody.innerHTML = "";

  const tasks = state.tasks
    .filter((t) => t.employeeId === emp.id)
    .sort((a, b) => a.id - b.id);

  if (!tasks.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "table-empty-row";
    td.textContent = "Este colaborador no tiene tareas asignadas.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  tasks.forEach((t) => {
    const tr = document.createElement("tr");
    tr.dataset.taskId = String(t.id);

    const overdue = isTaskPastDue(t.dueDate) && t.status !== STATUS.DONE;
    if (overdue) {
      tr.classList.add("task-row-overdue");
    }

    if (t.id === lastUpdatedTaskId) {
      tr.classList.add("task-row-flash");
    }

    if (t.id === lastUpdatedTaskId) {
      tr.classList.add("task-row-flash");
    }

    const idTd = document.createElement("td");
    idTd.textContent = String(t.id);
    const titleTd = document.createElement("td");
    titleTd.textContent = t.title;
    const dateTd = document.createElement("td");
    dateTd.textContent = formatDate(t.dueDate);
    const freqTd = document.createElement("td");
    freqTd.appendChild(createFrequencyBadge(t.frequency || "unica"));
    const priorityTd = document.createElement("td");
    const prioritySpan = document.createElement("span");
    const priority = t.priority || "media";
    prioritySpan.textContent =
      priority === "alta" ? "Alta" : priority === "baja" ? "Baja" : "Media";
    prioritySpan.className = "badge-priority badge-priority-" + priority;
    priorityTd.appendChild(prioritySpan);
    const statusTd = document.createElement("td");
    statusTd.appendChild(createStatusBadge(t.status));

    if (Array.isArray(t.checklist) && t.checklist.length) {
      const total = t.checklist.length;
      const done = t.checklist.filter((item) => item.done).length;
      const percent = Math.round((done / total) * 100);
      const info = document.createElement("div");
      info.className = "task-checklist-progress";
      info.textContent = `${done}/${total} items (${percent}%)`;
      statusTd.appendChild(info);
    }

    tr.appendChild(idTd);
    tr.appendChild(titleTd);
    tr.appendChild(dateTd);
    tr.appendChild(freqTd);
    tr.appendChild(priorityTd);
    tr.appendChild(statusTd);

    tbody.appendChild(tr);
  });
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function isTaskPastDue(iso) {
  if (!iso) return false;
  const todayStr = new Date().toISOString().slice(0, 10);
  return iso < todayStr;
}

function getTaskDueCategory(task) {
  if (!task || !task.dueDate) return "no_date";
  try {
    const today = new Date();
    const todayMid = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      0,
      0,
      0,
      0
    );
    const [y, m, d] = String(task.dueDate).split("-");
    const due = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
    const diffMs = due.getTime() - todayMid.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return "overdue";
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "tomorrow";
    return "future";
  } catch (e) {
    return "future";
  }
}

function isTaskAtRisk(task) {
  if (!task || task.status === STATUS.DONE) return false;
  const cat = getTaskDueCategory(task);
  const pr = (task.priority || "").toLowerCase();
  const isHigh = pr === "alta";

  if (cat === "overdue" || cat === "today") return true;
  if (cat === "tomorrow" && isHigh) return true;
  return false;
}

function createStatusBadge(status) {
  const span = document.createElement("span");
  const dot = document.createElement("span");
  dot.className = "badge-dot";

  if (status === STATUS.DONE) {
    span.className = "badge badge-done";
    span.textContent = "Completada";
  } else if (status === STATUS.IN_PROGRESS) {
    span.className = "badge badge-progress";
    span.textContent = "En progreso";
  } else {
    span.className = "badge badge-pending";
    span.textContent = "Pendiente";
  }

  span.prepend(dot);
  return span;
}

function createFrequencyBadge(freq) {
  const span = document.createElement("span");
  span.className = "badge badge-frequency";

  let label = "Única";
  if (freq === "diaria") label = "Diaria";
  else if (freq === "semanal") label = "Semanal";
  else if (freq === "mensual") label = "Mensual";
  else if (freq === "bimestral") label = "Bimestral";
  else if (freq === "trimestral") label = "Trimestral";
  else if (freq === "anual") label = "Anual";

  span.textContent = label;
  return span;
}

function canReassignTasks() {
  if (!currentUser) return false;
  return currentUser.role === "admin" || currentUser.role === "jefe_estacion";
}

function hydrateReassignSelect(task) {
  const select = document.getElementById("reassign-employee");
  if (!select) return;

  select.innerHTML = "";

  let employeesSource = [...state.employees];
  employeesSource.forEach((e) => {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = e.name;
    if (task && task.employeeId === e.id) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

function openReassignModal(taskId) {
  const task = state.tasks.find((t) => t.id === Number(taskId));
  if (!task) return;

  currentReassignTaskId = task.id;
  hydrateReassignSelect(task);

  const backdrop = document.getElementById("reassign-backdrop");
  if (backdrop) {
    backdrop.classList.remove("hidden");
  }
}

function closeReassignModal() {
  const backdrop = document.getElementById("reassign-backdrop");
  if (backdrop) {
    backdrop.classList.add("hidden");
  }
  currentReassignTaskId = null;
}

function hydrateAssignForm() {
  const select = document.getElementById("assign-employee");
  select.innerHTML = "";
  let employeesSource = [...state.employees];

  employeesSource.forEach((e) => {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = e.name;
    select.appendChild(opt);
  });

  if (state.selectedEmployeeId) {
    select.value = state.selectedEmployeeId;
  }
}

function renderTasksList() {
  const selectEmployee = document.getElementById("filter-employee");
  const selectStation = document.getElementById("filter-station");

  const prevEmployeeValue = selectEmployee.value;
  const prevStationValue = selectStation.value;
  let employeesSource = [...state.employees];

  selectEmployee.innerHTML = "<option value=\"\">Filtrar por empleado</option>";
  employeesSource.forEach((e) => {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = e.name;
    selectEmployee.appendChild(opt);
  });

  const stations = Array.from(new Set(employeesSource.map((e) => e.station)));
  selectStation.innerHTML = "<option value=\"\">Filtrar por estación</option>";
  stations.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    selectStation.appendChild(opt);
  });

  selectEmployee.value = prevEmployeeValue;
  selectStation.value = prevStationValue;

  const search = document.getElementById("tasks-search").value.trim().toLowerCase();
  const filterStatus = document.getElementById("filter-status").value;
  const riskCheckbox = document.getElementById("filter-risk-only");
  const riskOnly = riskCheckbox ? !!riskCheckbox.checked : false;

  let filtered = [...state.tasks];
  if (currentUser) {
    if (currentUser.role === "empleado") {
      let scopedIds = [];
      if (state.selectedEmployeeId) {
        scopedIds = [state.selectedEmployeeId];
      } else {
        scopedIds = state.employees
          .filter(
            (e) => e.name && e.name.toLowerCase() === currentUser.name.toLowerCase()
          )
          .map((e) => e.id);
      }
      if (scopedIds.length) {
        const idSet = new Set(scopedIds);
        filtered = filtered.filter((t) => idSet.has(t.employeeId));
      } else {
        filtered = [];
      }
    }
  }

  if (selectEmployee.value) {
    filtered = filtered.filter((t) => t.employeeId === selectEmployee.value);
  }
  if (selectStation.value) {
    filtered = filtered.filter((t) => t.station === selectStation.value);
  }
  if (filterStatus) {
    filtered = filtered.filter((t) => t.status === filterStatus);
  }
  if (search) {
    filtered = filtered.filter((t) => {
      const emp = findEmployee(t.employeeId);
      const empName = emp ? emp.name.toLowerCase() : "";
      return (
        t.title.toLowerCase().includes(search) || empName.includes(search)
      );
    });
  }

  const dateRangeSelect = document.getElementById("filter-date-range");
  const dateRange = dateRangeSelect ? dateRangeSelect.value : "";

  if (dateRange) {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    if (dateRange === "today") {
      filtered = filtered.filter((t) => t.dueDate === todayStr);
    } else if (dateRange === "7" || dateRange === "30") {
      const limit = new Date(today);
      limit.setDate(limit.getDate() + (dateRange === "7" ? 7 : 30));
      const limitStr = limit.toISOString().slice(0, 10);
      filtered = filtered.filter(
        (t) =>
          t.dueDate && t.dueDate >= todayStr && t.dueDate <= limitStr
      );
    } else if (dateRange === "overdue") {
      filtered = filtered.filter(
        (t) =>
          t.dueDate &&
          t.dueDate < todayStr &&
          t.status !== STATUS.DONE
      );
    }
  } else if (tasksTodayOnly) {
    const todayStr = new Date().toISOString().slice(0, 10);
    filtered = filtered.filter((t) => t.dueDate === todayStr);
  }

  if (riskOnly) {
    filtered = filtered.filter((t) => isTaskAtRisk(t));
  }

  filtered.sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));

  const tbody = document.querySelector("#tasks-table tbody");
  tbody.innerHTML = "";

  const total = filtered.length;
  const maxPage = total ? Math.ceil(total / TASKS_PAGE_SIZE) : 1;
  if (tasksPage > maxPage) tasksPage = maxPage;
  if (tasksPage < 1) tasksPage = 1;

  const start = (tasksPage - 1) * TASKS_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + TASKS_PAGE_SIZE);

  if (!pageItems.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.className = "table-empty-row";
    td.textContent = tasksTodayOnly
      ? "Sin tareas para hoy con los filtros actuales."
      : "Sin tareas con los filtros actuales.";
    tr.appendChild(td);
    tbody.appendChild(tr);

    const infoEl = document.getElementById("tasks-pagination-info");
    if (infoEl) infoEl.textContent = "0 tareas";
    const prevBtn = document.getElementById("tasks-page-prev");
    const nextBtn = document.getElementById("tasks-page-next");
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;

    if (employeeCalendar) {
      refreshEmployeeCalendarEvents();
    }
    return;
  }

  pageItems.forEach((t) => {
    const tr = document.createElement("tr");
    tr.dataset.taskId = String(t.id);
    const emp = findEmployee(t.employeeId);

    const overdue = isTaskPastDue(t.dueDate) && t.status !== STATUS.DONE;
    if (overdue) {
      tr.classList.add("task-row-overdue");
    }

    if (t.id === lastUpdatedTaskId) {
      tr.classList.add("task-row-flash");
    }

    const idTd = document.createElement("td");
    idTd.textContent = String(t.id);

    const empTd = document.createElement("td");
    empTd.textContent = emp ? emp.name : "-";

    const titleTd = document.createElement("td");
    titleTd.textContent = t.title;

    const dateTd = document.createElement("td");
    dateTd.textContent = formatDate(t.dueDate);

    const freqTd = document.createElement("td");
    freqTd.appendChild(createFrequencyBadge(t.frequency || "unica"));

    const priorityTd = document.createElement("td");
    const prioritySpan = document.createElement("span");
    const priority = t.priority || "media";
    prioritySpan.textContent =
      priority === "alta" ? "Alta" : priority === "baja" ? "Baja" : "Media";
    prioritySpan.className = "badge-priority badge-priority-" + priority;
    priorityTd.appendChild(prioritySpan);

    const statusTd = document.createElement("td");
    statusTd.appendChild(createStatusBadge(t.status));

    if (Array.isArray(t.checklist) && t.checklist.length) {
      const total = t.checklist.length;
      const done = t.checklist.filter((item) => item.done).length;
      const percent = Math.round((done / total) * 100);
      const info = document.createElement("div");
      info.className = "task-checklist-progress";
      info.textContent = `${done}/${total} items (${percent}%)`;
      statusTd.appendChild(info);
    }

    if (t.notes && String(t.notes).trim().length) {
      const notesBadge = document.createElement("span");
      notesBadge.className = "badge-note";
      notesBadge.textContent = "Obs";
      notesBadge.title = String(t.notes).trim();
      statusTd.appendChild(notesBadge);
    }

    if (t.evidenceUrl && String(t.evidenceUrl).trim().length) {
      const evidenceBadge = document.createElement("span");
      evidenceBadge.className = "badge-evidence";
      evidenceBadge.textContent = "Evid.";
      evidenceBadge.title = String(t.evidenceUrl).trim();
      statusTd.appendChild(evidenceBadge);
    }

    const actionsTd = document.createElement("td");
    if (canReassignTasks()) {
      const btn = document.createElement("button");

  const from = start + 1;
  const to = start + pageItems.length;
  const infoEl = document.getElementById("tasks-pagination-info");
  if (infoEl) {
    infoEl.textContent = `Mostrando ${from}-${to} de ${total}`;
  }
  const prevBtn = document.getElementById("tasks-page-prev");
  const nextBtn = document.getElementById("tasks-page-next");
  if (prevBtn) prevBtn.disabled = tasksPage <= 1;
  if (nextBtn) nextBtn.disabled = tasksPage >= maxPage;
      btn.type = "button";
      btn.className = "ghost-btn task-reassign-btn";
      btn.textContent = "Reasignar";
      actionsTd.appendChild(btn);
    } else {
      actionsTd.textContent = "-";
    }

    tr.appendChild(idTd);
    tr.appendChild(empTd);
    tr.appendChild(titleTd);
    tr.appendChild(dateTd);
    tr.appendChild(freqTd);
    tr.appendChild(priorityTd);
    tr.appendChild(statusTd);
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  });

  if (employeeCalendar) {
    refreshEmployeeCalendarEvents();
  }
}

function showDeleteEmployeeModal() {
  const emp = findEmployee(state.selectedEmployeeId);
  if (!emp) return;

  const backdrop = document.getElementById("modal-backdrop");
  const title = document.getElementById("modal-title");
  const message = document.getElementById("modal-message");
  const confirmBtn = document.getElementById("modal-confirm");

  title.textContent = "Eliminar operador";
  message.textContent = `¿Seguro que desea eliminar a ${emp.name}? Sus tareas seguirán registradas pero sin operador asignado.`;

  const handler = () => {
    state.employees = state.employees.filter((e) => e.id !== emp.id);
    state.tasks = state.tasks.map((t) =>
      t.employeeId === emp.id ? { ...t, employeeId: null } : t
    );
    state.selectedEmployeeId = state.employees[0]?.id || null;
    saveState();
    backdrop.classList.add("hidden");
    confirmBtn.removeEventListener("click", handler);
    setView("view-team");
    renderTeam();
    showToast("Operador eliminado", "success");
  };

  confirmBtn.addEventListener("click", handler);
  backdrop.classList.remove("hidden");
}

function hideModal() {
  document.getElementById("modal-backdrop").classList.add("hidden");
}

function openActivityModal(taskId) {
  const task = state.tasks.find((t) => t.id === Number(taskId));
  if (!task) return;

  currentActivityTaskId = task.id;

  const emp = findEmployee(task.employeeId);
  const summary = document.getElementById("activity-summary");
  const manualInput = document.getElementById("activity-manual");
  const notesInput = document.getElementById("activity-notes");
  const evidenceInput = document.getElementById("activity-evidence");
  const statusSelect = document.getElementById("activity-status");
  const historyContainer = document.getElementById("activity-history");
  const checklistContainer = document.getElementById("activity-checklist");

  if (summary) {
    const parts = [];
    if (emp) parts.push(`Operador: ${emp.name}`);
    parts.push(`Tarea: ${task.title}`);
    if (task.dueDate) parts.push(`Fecha límite: ${formatDate(task.dueDate)}`);
    summary.textContent = parts.join(" · ");
  }

  if (manualInput) manualInput.value = task.manualUrl || "";
  if (notesInput) notesInput.value = task.notes || "";
  if (evidenceInput) evidenceInput.value = task.evidenceUrl || "";
  if (statusSelect) statusSelect.value = task.status || STATUS.PENDING;

  if (checklistContainer) {
    checklistContainer.innerHTML = "";
    const checklist = Array.isArray(task.checklist) ? task.checklist : [];
    if (!checklist.length) {
      const empty = document.createElement("p");
      empty.className = "activity-checklist-empty";
      empty.textContent = "Esta tarea no tiene checklist definido.";
      checklistContainer.appendChild(empty);
    } else {
      checklist.forEach((item, index) => {
        const row = document.createElement("label");
        row.className = "activity-checklist-item";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = !!item.done;
        checkbox.dataset.index = String(index);

        const text = document.createElement("span");
        text.textContent = item.label || `Paso ${index + 1}`;

        row.appendChild(checkbox);
        row.appendChild(text);
        checklistContainer.appendChild(row);
      });
    }
  }

  if (historyContainer) {
    historyContainer.innerHTML = "";
    const history = Array.isArray(task.history) ? task.history : [];
    if (!history.length) {
      const empty = document.createElement("p");
      empty.className = "activity-history-empty";
      empty.textContent = "Sin historial previo.";
      historyContainer.appendChild(empty);
    } else {
      history
        .slice()
        .reverse()
        .forEach((h) => {
          const row = document.createElement("div");
          row.className = "activity-history-item";
          const when = document.createElement("div");
          when.className = "activity-history-meta";
          when.textContent = h.when || "";
          const detail = document.createElement("div");
          detail.className = "activity-history-text";
          const statusLabel =
            h.status === STATUS.DONE
              ? "Completada"
              : h.status === STATUS.IN_PROGRESS
              ? "En progreso"
              : "Pendiente";
          detail.textContent = `${statusLabel} · ${h.notes || ""}`;
          row.appendChild(when);
          row.appendChild(detail);
          historyContainer.appendChild(row);
        });
    }
  }

  document.getElementById("activity-backdrop").classList.remove("hidden");
}

function closeActivityModal() {
  const backdrop = document.getElementById("activity-backdrop");
  if (backdrop) {
    backdrop.classList.add("hidden");
  }
  currentActivityTaskId = null;
}

function applyAuthState() {

  // Inactividad: resetear temporizador en eventos de usuario
  ["click", "keydown", "mousemove"].forEach((evt) => {
    window.addEventListener(evt, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
  const loginShell = document.getElementById("login-shell");
  const appShell = document.getElementById("app-shell");
  const nameSpan = document.querySelector(".topbar-user-name");

  if (!loginShell || !appShell) return;

  if (isAuthenticated()) {
    const storedName =
      window.localStorage.getItem(`${AUTH_KEY}-name`) || "Alejandro Torres";
    if (nameSpan) nameSpan.textContent = storedName;
    loginShell.classList.add("hidden");
    appShell.classList.remove("hidden");
  } else {
    appShell.classList.add("hidden");
    loginShell.classList.remove("hidden");
  }
}

function setupEvents() {
  const logoutBtn = document.querySelector(".logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      try {
        const rawAdmin = window.localStorage.getItem(ADMIN_STORAGE_KEY);
        let adminData;
        if (rawAdmin) {
          try {
            adminData = JSON.parse(rawAdmin);
          } catch (err) {
            console.error("No se pudo parsear almacenamiento admin para cierre de sesión", err);
            adminData = {};
          }
        } else {
          adminData = {};
        }

        const generalLogs = Array.isArray(adminData.generalLogs)
          ? adminData.generalLogs
          : [];

        const nextId =
          generalLogs.reduce((max, l) => Math.max(max, l.id || 0), 0) + 1;
        const now = new Date();
        const date = now.toISOString().slice(0, 10);
        const time = now.toTimeString().slice(0, 5);

        const userInfo = typeof getCurrentUser === "function" ? getCurrentUser() : null;
        const name = userInfo && userInfo.name ? userInfo.name : "Usuario";
        const role = userInfo && userInfo.role ? userInfo.role : "empleado";
        const username = userInfo && userInfo.username ? userInfo.username : "";

        generalLogs.push({
          id: nextId,
          user: name,
          role,
          activity: "Cierre de sesión",
          description: `Usuario ${username || name} cerró sesión (panel operación)`,
          date,
          time,
          status: "ok",
        });

        adminData.generalLogs = generalLogs;
        window.localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminData));
      } catch (err) {
        console.error("No se pudo registrar cierre de sesión en bitácora general", err);
      }

      clearAuth();
      window.location.href = "login.html";
    });
  }

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.getAttribute("data-view");
      if (view === "dashboard") setView("view-dashboard");
      if (view === "myday") setView("view-myday");
      if (view === "team") {
        if (currentUser && currentUser.role === "empleado") {
          setView("view-tasks");
        } else {
          setView("view-team");
        }
      }
      if (view === "tasks") setView("view-tasks");
      if (view === "profile") setView("view-profile");
    });
  });

  document
    .querySelectorAll('[data-view="team"].ghost-link')
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        if (currentUser && currentUser.role === "empleado") {
          setView("view-tasks");
        } else {
          setView("view-team");
        }
      });
    });

  const assignFromEmpBtn = document.getElementById("btn-assign-task-from-employee");
  if (assignFromEmpBtn) {
    assignFromEmpBtn.addEventListener("click", () => {
      if (currentUser && currentUser.role === "empleado") return;
      setView("view-assign");
    });
  }

  document
    .getElementById("btn-cancel-assign")
    .addEventListener("click", () => setView("view-dashboard"));

  const templateSelect = document.getElementById("assign-template");
  if (templateSelect) {
    templateSelect.addEventListener("change", () => {
      const value = templateSelect.value;
      const titleInput = document.getElementById("assign-title");
      const descInput = document.getElementById("assign-description");
      const freqSelect = document.getElementById("assign-frequency");
      const prioritySelect = document.getElementById("assign-priority");

      if (!titleInput || !descInput || !freqSelect || !prioritySelect) return;

      if (value === "apertura") {
        titleInput.value = "Checklist de apertura de estación";
        descInput.value =
          "1) Verificar extintores y kits de derrame.\n2) Revisar conos y señalamientos.\n3) Confirmar niveles de tanques dentro de rango.\n4) Validar limpieza de islas y accesos.";
        freqSelect.value = "diaria";
        prioritySelect.value = "alta";
      } else if (value === "cierre") {
        titleInput.value = "Checklist de cierre de estación";
        descInput.value =
          "1) Asegurar válvulas y equipos.\n2) Registrar niveles finales de tanque.\n3) Verificar corte de terminales y arqueos.\n4) Revisar cierre de accesos y candados.";
        freqSelect.value = "diaria";
        prioritySelect.value = "alta";
      } else if (value === "ronda_seguridad") {
        titleInput.value = "Ronda de seguridad";
        descInput.value =
          "1) Recorrido perimetral de la estación.\n2) Verificar alumbrado y cámaras.\n3) Revisar presencia de fugas o derrames.\n4) Confirmar integridad de cercas y accesos.";
        freqSelect.value = "diaria";
        prioritySelect.value = "alta";
      } else if (value === "descarga") {
        titleInput.value = "Recepción y descarga de autotanque";
        descInput.value =
          "1) Verificar documentación del autotanque.\n2) Colocar barreras y señalamientos.\n3) Conectar mangueras y aterrizaje estático.\n4) Supervisar niveles durante la descarga.\n5) Registrar volúmenes recibidos y novedades.";
        freqSelect.value = "unica";
        prioritySelect.value = "alta";
      }
    });
  }

  const deleteBtn = document.getElementById("btn-delete-employee");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      if (currentUser && currentUser.role === "empleado") return;
      showDeleteEmployeeModal();
    });
  }

  document
    .getElementById("modal-cancel")
    .addEventListener("click", hideModal);

  document
    .getElementById("modal-backdrop")
    .addEventListener("click", (e) => {
      if (e.target.id === "modal-backdrop") hideModal();
    });

  document.getElementById("assign-form").addEventListener("submit", (e) => {
    e.preventDefault();

    const employeeId = document.getElementById("assign-employee").value;
    const templateKey = document.getElementById("assign-template").value;
    const title = document.getElementById("assign-title").value.trim();
    const description = document
      .getElementById("assign-description")
      .value.trim();
    const dueDate = document.getElementById("assign-date").value;
    const dueTime = document.getElementById("assign-time").value;
    const frequency =
      document.getElementById("assign-frequency").value || "unica";
    const priority =
      document.getElementById("assign-priority").value || "media";

    if (!employeeId || !title || !dueDate || !dueTime) {
      showToast("Completa operador, título, fecha y hora para asignar.", "warning");
      return;
    }

    const emp = findEmployee(employeeId);
    const newId = state.lastTaskId + 1;

    state.tasks.push({
      id: newId,
      employeeId,
      title,
      description,
      dueDate,
      dueTime,
      status: STATUS.PENDING,
      frequency,
      priority,
      station: emp ? emp.station : "",
      template: templateKey || "",
      checklist: getChecklistForTemplate(templateKey),
    });

    state.lastTaskId = newId;
    state.selectedEmployeeId = employeeId;
    lastUpdatedTaskId = newId;
    saveState();

    document.getElementById("assign-form").reset();

    if (employeeCalendar) {
      refreshEmployeeCalendarEvents();
    }

    setView("view-employee");
    showToast("Tarea asignada", "success");
  });

  [
    "tasks-search",
    "filter-employee",
    "filter-station",
    "filter-status",
    "filter-date-range",
    "filter-risk-only",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const debouncedRenderTasksList = debounce(() => {
      tasksPage = 1;
      renderTasksList();
    }, 180);
    el.addEventListener("input", debouncedRenderTasksList);
    el.addEventListener("change", debouncedRenderTasksList);
  });

  // Restaurar filtros de lista de tareas desde última sesión
  try {
    const rawTaskFilters = window.localStorage.getItem(TASK_FILTERS_KEY);
    if (rawTaskFilters) {
      const f = JSON.parse(rawTaskFilters);
      const searchInput = document.getElementById("tasks-search");
      const empSelect = document.getElementById("filter-employee");
      const stationSelect = document.getElementById("filter-station");
      const statusSelect = document.getElementById("filter-status");
      const dateRangeSelect = document.getElementById("filter-date-range");
      const riskCheckbox = document.getElementById("filter-risk-only");

      if (searchInput && f.search != null) searchInput.value = f.search;
      if (empSelect && f.employeeId != null) empSelect.value = f.employeeId;
      if (stationSelect && f.station != null) stationSelect.value = f.station;
      if (statusSelect && f.status != null) statusSelect.value = f.status;
      if (dateRangeSelect && f.dateRange != null)
        dateRangeSelect.value = f.dateRange;
      if (riskCheckbox && typeof f.riskOnly === "boolean") {
        riskCheckbox.checked = f.riskOnly;
      }

      if (typeof f.todayOnly === "boolean") {
        tasksTodayOnly = f.todayOnly;
        if (btnTasksToday) {
          if (tasksTodayOnly) btnTasksToday.classList.add("is-active");
          else btnTasksToday.classList.remove("is-active");
        }
      }
    }
  } catch (e) {
    // silencioso
  }

  const btnTasksToday = document.getElementById("btn-tasks-today");
  const btnTasksExport = document.getElementById("btn-tasks-export");
  const tasksPrevBtn = document.getElementById("tasks-page-prev");
  const tasksNextBtn = document.getElementById("tasks-page-next");

  const btnTasksClear = document.getElementById("btn-tasks-clear");
  if (btnTasksClear) {
    btnTasksClear.addEventListener("click", () => {
      const searchInput = document.getElementById("tasks-search");
      const empSelect = document.getElementById("filter-employee");
      const stationSelect = document.getElementById("filter-station");
      const statusSelect = document.getElementById("filter-status");
      const dateRangeSelect = document.getElementById("filter-date-range");
      const riskCheckbox = document.getElementById("filter-risk-only");

      if (searchInput) searchInput.value = "";
      if (empSelect) empSelect.value = "";
      if (stationSelect) stationSelect.value = "";
      if (statusSelect) statusSelect.value = "";
      if (dateRangeSelect) dateRangeSelect.value = "";
      if (riskCheckbox) riskCheckbox.checked = false;

      tasksTodayOnly = false;
      if (btnTasksToday) btnTasksToday.classList.remove("is-active");

      tasksPage = 1;
      renderTasksList();
    });
  }

  if (btnTasksToday) {
    btnTasksToday.addEventListener("click", () => {
      tasksTodayOnly = !tasksTodayOnly;
      btnTasksToday.classList.toggle("is-active", tasksTodayOnly);
      tasksPage = 1;
      renderTasksList();
    });
  }

  if (btnTasksExport) {
    btnTasksExport.addEventListener("click", () => {
      exportTasksCsv();
    });
  }

  if (tasksPrevBtn) {
    tasksPrevBtn.addEventListener("click", () => {
      if (tasksPage > 1) {
        tasksPage -= 1;
        renderTasksList();
      }
    });
  }

  const btnDashboardCriticalViewTasks = document.getElementById(
    "btn-dashboard-critical-view-tasks"
  );
  if (btnDashboardCriticalViewTasks) {
    btnDashboardCriticalViewTasks.addEventListener("click", () => {
      setView("view-tasks");
    });
  }

  if (tasksNextBtn) {
    tasksNextBtn.addEventListener("click", () => {
      tasksPage += 1;
      renderTasksList();
    });
  }

  const tasksTbody = document.querySelector("#tasks-table tbody");
  if (tasksTbody) {
    tasksTbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr");
      if (!tr || !tr.dataset.taskId) return;
      const isReassignBtn = e.target.closest(".task-reassign-btn");
      if (isReassignBtn) {
        if (!canReassignTasks()) {
          showToast("No tienes permisos para reasignar tareas.", "error");
          return;
        }
        openReassignModal(tr.dataset.taskId);
        return;
      }
      openActivityModal(tr.dataset.taskId);
    });
  }

  const myDayTbody = document.querySelector("#myday-table tbody");
  if (myDayTbody) {
    myDayTbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr");
      if (!tr || !tr.dataset.taskId) return;
      openActivityModal(tr.dataset.taskId);
    });
  }

  const empTasksTbody = document.querySelector("#employee-tasks-table tbody");
  if (empTasksTbody) {
    empTasksTbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr");
      if (!tr || !tr.dataset.taskId) return;
      openActivityModal(tr.dataset.taskId);
    });
  }

  const activitySave = document.getElementById("activity-save");
  const activityCancel = document.getElementById("activity-cancel");
  const activityBackdrop = document.getElementById("activity-backdrop");

  if (activitySave) {
    activitySave.addEventListener("click", () => {
      if (!currentActivityTaskId) return;
      const task = state.tasks.find((t) => t.id === Number(currentActivityTaskId));
      if (!task) return;

      const manualInput = document.getElementById("activity-manual");
      const notesInput = document.getElementById("activity-notes");
      const evidenceInput = document.getElementById("activity-evidence");
      const statusSelect = document.getElementById("activity-status");
      const checklistContainer = document.getElementById("activity-checklist");

      task.manualUrl = manualInput ? manualInput.value.trim() : task.manualUrl;
      task.notes = notesInput ? notesInput.value.trim() : task.notes;
      task.evidenceUrl = evidenceInput ? evidenceInput.value.trim() : task.evidenceUrl;
      let newStatus = statusSelect ? statusSelect.value : task.status;

      if (checklistContainer && Array.isArray(task.checklist) && task.checklist.length) {
        const checkboxes = checklistContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((cb) => {
          const index = Number(cb.dataset.index);
          if (!Number.isNaN(index) && task.checklist[index]) {
            task.checklist[index].done = cb.checked;
          }
        });

        const total = task.checklist.length;
        const done = task.checklist.filter((item) => item.done).length;
        if (done === 0) {
          newStatus = STATUS.PENDING;
        } else if (done > 0 && done < total) {
          newStatus = STATUS.IN_PROGRESS;
        } else if (done === total) {
          newStatus = STATUS.DONE;
        }
      }

      const historyEntry = {
        when: new Date().toLocaleString(),
        status: newStatus,
        notes: notesInput ? notesInput.value.trim() : "",
      };
      if (!Array.isArray(task.history)) {
        task.history = [];
      }
      task.history.push(historyEntry);

      task.status = newStatus;
      lastUpdatedTaskId = task.id;

      if (
        task.status === STATUS.DONE &&
        task.dueDate &&
        task.frequency &&
        task.frequency !== "unica"
      ) {
        try {
          const baseDate = new Date(task.dueDate + "T00:00:00");
          if (!Number.isNaN(baseDate.getTime())) {
            if (task.frequency === "diaria") {
              baseDate.setDate(baseDate.getDate() + 1);
            } else if (task.frequency === "semanal") {
              baseDate.setDate(baseDate.getDate() + 7);
            } else if (task.frequency === "mensual") {
              baseDate.setMonth(baseDate.getMonth() + 1);
            }
            const nextDate = baseDate.toISOString().slice(0, 10);
            const empForTask = findEmployee(task.employeeId);
            const nextId = state.lastTaskId + 1;
            state.tasks.push({
              id: nextId,
              employeeId: task.employeeId,
              title: task.title,
              description: task.description,
              dueDate: nextDate,
              dueTime: task.dueTime,
              status: STATUS.PENDING,
              frequency: task.frequency,
              priority: task.priority || "media",
              station: empForTask ? empForTask.station : task.station || "",
              template: task.template || "",
              checklist: Array.isArray(task.checklist)
                ? task.checklist.map((item) => ({
                    label: item.label,
                    done: false,
                  }))
                : [],
            });
            state.lastTaskId = nextId;
          }
        } catch (e) {
          console.error("No se pudo generar tarea recurrente", e);
        }
      }

      saveState();
      renderDashboard();
      renderTasksList();
      renderEmployeeDetail();
      if (employeeCalendar) {
        refreshEmployeeCalendarEvents();
      }

      closeActivityModal();
      showToast("Actividad actualizada", "success");
    });
  }

  const empProfileForm = document.getElementById("employee-profile-form");
  if (empProfileForm) {
    empProfileForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!currentUser) return;

      const { adminData, user } = findCurrentUserRecordForProfile();

      const fullName = document
        .getElementById("emp-profile-fullname")
        .value.trim();
      const area = document.getElementById("emp-profile-area").value.trim();
      const position = document
        .getElementById("emp-profile-position")
        .value.trim();
      const rfc = document.getElementById("emp-profile-rfc").value.trim();
      const stationRfc = document
        .getElementById("emp-profile-station-rfc")
        .value.trim();
      const email = document.getElementById("emp-profile-email").value.trim();
      const phone = document.getElementById("emp-profile-phone").value.trim();
      const photoUrl = document.getElementById("emp-profile-photo").value.trim();

      const currentPass = document
        .getElementById("emp-profile-current-password")
        ?.value.trim() || "";
      const newPass = document
        .getElementById("emp-profile-new-password")
        ?.value.trim() || "";
      const confirmPass = document
        .getElementById("emp-profile-new-password-confirm")
        ?.value.trim() || "";

      const nameToUse = fullName || currentUser.name;

      let updatedUsers = adminData.users.slice();
      let target = user;
      if (!target) {
        const nextId =
          updatedUsers.reduce((max, u) => Math.max(max, u.id || 0), 0) + 1;
        target = {
          id: nextId,
          name: nameToUse,
          username:
            currentUser.username ||
            window.localStorage.getItem(`${AUTH_KEY}-username`) ||
            "",
          role: currentUser.role,
          stationId: "",
          area: area || currentUser.area || "",
        };
        updatedUsers.push(target);
      }

      target.name = nameToUse;
      target.area = area || target.area || "";
      target.position = position;
      target.rfc = rfc;
      target.stationRfc = stationRfc;
      target.email = email;
      target.phone = phone;
      target.photoUrl = photoUrl;

      // Manejo de cambio de contraseña (opcional)
      if (newPass || confirmPass || currentPass) {
        // Validar todos los campos si se intenta cambiar contraseña
        if (!currentPass || !newPass || !confirmPass) {
          showToast("Para cambiar la contraseña completa los tres campos.", "warning");
          return;
        }

        if (user && user.password && user.password !== currentPass) {
          showToast("La contraseña actual no es correcta.", "error");
          return;
        }

        if (newPass !== confirmPass) {
          showToast("La confirmación no coincide con la nueva contraseña.", "error");
          return;
        }

        if (newPass === currentPass) {
          showToast(
            "La nueva contraseña debe ser diferente a la actual.",
            "warning"
          );
          return;
        }

        if (newPass.length < 8) {
          showToast(
            "La nueva contraseña debe tener al menos 8 caracteres.",
            "warning"
          );
          return;
        }

        if (!/[A-Z]/.test(newPass)) {
          showToast(
            "La nueva contraseña debe incluir al menos una letra mayúscula.",
            "warning"
          );
          return;
        }

        if (!/[a-z]/.test(newPass)) {
          showToast(
            "La nueva contraseña debe incluir al menos una letra minúscula.",
            "warning"
          );
          return;
        }

        if (!/[0-9]/.test(newPass)) {
          showToast(
            "La nueva contraseña debe incluir al menos un número.",
            "warning"
          );
          return;
        }

        const todayIso = new Date().toISOString().slice(0, 10);

        // Usuarios administradores pueden cambiar su contraseña directamente
        if (currentUser.role === "admin") {
          target.password = newPass;
          target.passwordLastChanged = todayIso;
        } else {
          // Para otros roles, registrar una solicitud de cambio para aprobación de un administrador
          target.pendingPassword = newPass;
          target.pendingPasswordRequestedAt = todayIso;
          target.pendingPasswordStatus = "pendiente";

          showToast(
            "Solicitud de cambio de contraseña enviada. Un administrador debe aprobarla.",
            "success"
          );
        }
      }

      const newAdminData = {
        stations: adminData.stations,
        logs: adminData.logs,
        generalLogs: adminData.generalLogs,
        users: updatedUsers,
        shifts: adminData.shifts,
      };
      window.localStorage.setItem(
        ADMIN_STORAGE_KEY,
        JSON.stringify(newAdminData)
      );

      // Limpiar campos de contraseña después de guardar
      try {
        const c = document.getElementById("emp-profile-current-password");
        const n = document.getElementById("emp-profile-new-password");
        const f = document.getElementById("emp-profile-new-password-confirm");
        if (c) c.value = "";
        if (n) n.value = "";
        if (f) f.value = "";
      } catch (e) {
        console.warn("No se pudieron limpiar los campos de contraseña en Mi perfil", e);
      }

      currentUser.name = nameToUse;
      currentUser.area = area || currentUser.area;
      const storedUsername =
        currentUser.username ||
        window.localStorage.getItem(`${AUTH_KEY}-username`) ||
        "";
      setAuthenticated(nameToUse, currentUser.role, currentUser.area, storedUsername);

      const nameSpan = document.querySelector(".topbar-user-name");
      const roleSpan = document.querySelector(".topbar-user-role");
      const avatarEl = document.querySelector(".topbar-user-avatar");

      if (nameSpan) nameSpan.textContent = nameToUse;
      if (roleSpan) {
        let roleLabel = "Operador";
        if (currentUser.role === "admin") roleLabel = "Administrador";
        else if (currentUser.role === "jefe_estacion") roleLabel = "Jefe de estación";
        roleSpan.textContent = roleLabel;
      }
      if (avatarEl) {
        avatarEl.textContent = getInitials(nameToUse);
      }

      const welcomeAccent = document.querySelector(
        "#view-dashboard .view-header .accent"
      );
      if (welcomeAccent) {
        welcomeAccent.textContent = nameToUse;
      }

      renderEmployeeProfile();
      showToast("Perfil actualizado correctamente.");
    });
  }

  if (activityCancel) {
    activityCancel.addEventListener("click", () => {
      closeActivityModal();
    });
  }

  if (activityBackdrop) {
    activityBackdrop.addEventListener("click", (e) => {
      if (e.target.id === "activity-backdrop") {
        closeActivityModal();
      }
    });
  }

  const reassignConfirm = document.getElementById("reassign-confirm");
  const reassignCancel = document.getElementById("reassign-cancel");
  const reassignBackdrop = document.getElementById("reassign-backdrop");

  if (reassignConfirm) {
    reassignConfirm.addEventListener("click", () => {
      if (!currentReassignTaskId) return;
      if (!canReassignTasks()) {
        showToast("No tienes permisos para reasignar tareas.", "error");
        return;
      }

      const select = document.getElementById("reassign-employee");
      if (!select || !select.value) {
        showToast("Selecciona el nuevo responsable de la tarea.", "warning");
        return;
      }

      const task = state.tasks.find((t) => t.id === Number(currentReassignTaskId));
      if (!task) {
        closeReassignModal();
        return;
      }

      const newEmployeeId = select.value;
      if (task.employeeId === newEmployeeId) {
        showToast("Selecciona un operador diferente para reasignar.", "warning");
        return;
      }

      const oldEmp = findEmployee(task.employeeId);
      const newEmp = findEmployee(newEmployeeId);

      task.employeeId = newEmployeeId;
      task.station = newEmp ? newEmp.station : task.station || "";

      const historyNoteParts = [];
      if (oldEmp) historyNoteParts.push(`De: ${oldEmp.name}`);
      if (newEmp) historyNoteParts.push(`A: ${newEmp.name}`);
      const historyNote = historyNoteParts.length
        ? `Reasignación de tarea (${historyNoteParts.join(" · ")})`
        : "Reasignación de tarea";

      const historyEntry = {
        when: new Date().toLocaleString(),
        status: task.status,
        notes: historyNote,
      };
      if (!Array.isArray(task.history)) {
        task.history = [];
      }
      task.history.push(historyEntry);

      lastUpdatedTaskId = task.id;

      saveState();
      renderDashboard();
      renderTasksList();
      renderEmployeeDetail();
      if (employeeCalendar) {
        refreshEmployeeCalendarEvents();
      }

      try {
        const rawAdmin = window.localStorage.getItem(ADMIN_STORAGE_KEY);
        let adminData = rawAdmin ? JSON.parse(rawAdmin) : {};
        const generalLogs = Array.isArray(adminData.generalLogs)
          ? adminData.generalLogs
          : [];
        const nextId =
          generalLogs.reduce((max, l) => Math.max(max, l.id || 0), 0) + 1;
        const now = new Date();
        const date = now.toISOString().slice(0, 10);
        const time = now.toTimeString().slice(0, 5);

        const userInfo =
          typeof getCurrentUser === "function" ? getCurrentUser() : null;
        const name = userInfo && userInfo.name ? userInfo.name : "Usuario";
        const role = userInfo && userInfo.role ? userInfo.role : "empleado";
        const username = userInfo && userInfo.username ? userInfo.username : "";

        generalLogs.push({
          id: nextId,
          user: name,
          role,
          activity: "Reasignación de tarea",
          description: `${username || name} reasignó la tarea ${task.id} de ${
            oldEmp ? oldEmp.name : "(sin asignar)"
          } a ${newEmp ? newEmp.name : "(sin asignar)"}.`,
          date,
          time,
          status: "ok",
        });

        adminData.generalLogs = generalLogs;
        window.localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminData));
      } catch (err) {
        console.error("No se pudo registrar la reasignación en bitácora general", err);
      }

      closeReassignModal();
      showToast("Tarea reasignada correctamente.");
    });
  }

  if (reassignCancel) {
    reassignCancel.addEventListener("click", () => {
      closeReassignModal();
    });
  }

  if (reassignBackdrop) {
    reassignBackdrop.addEventListener("click", (e) => {
      if (e.target.id === "reassign-backdrop") {
        closeReassignModal();
      }
    });
  }

  const pipaSaveBtn = document.getElementById("pipa-save");
  if (pipaSaveBtn) {
    pipaSaveBtn.addEventListener("click", () => {
      registerFuelDeliveryFromForm();
    });
  }

  // Plantillas rápidas de proveedor para recepciones de pipa
  const supplierTemplateButtons = document.querySelectorAll(
    "[data-supplier-template]"
  );
  if (supplierTemplateButtons && supplierTemplateButtons.length) {
    supplierTemplateButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const value = btn.getAttribute("data-supplier-template") || "";
        const supplierInput = document.getElementById("pipa-supplier");
        if (supplierInput) {
          supplierInput.value = value;
          supplierInput.focus();
        }
      });
    });
  }

  const mainHelpPanel = document.getElementById("main-help-panel");
  const mainHelpClose = document.getElementById("main-help-close");
  if (mainHelpPanel && mainHelpClose) {
    const list = mainHelpPanel.querySelector("ul");
    if (list) {
      let role = null;
      if (typeof getCurrentUser === "function") {
        const cu = getCurrentUser();
        role = cu && cu.role;
      } else if (currentUser) {
        role = currentUser.role;
      }

      if (role === "empleado") {
        list.innerHTML = `
          <li><strong>Inicio:</strong> ve tus KPIs personales y calendario.</li>
          <li><strong>Mis tareas:</strong> solo ves tus propias actividades.</li>
          <li><strong>Detalle de tarea:</strong> registra observaciones, evidencia y estado.</li>
          <li><strong>Mi perfil:</strong> actualiza tus datos de contacto y RFC.</li>
          <li><strong>Atajos:</strong> Ctrl+K abre la búsqueda de tareas; Alt+1..5 cambia rápidamente entre Inicio, Mi día, Mis tareas y Mi perfil.</li>
        `;
      }
    }

    const seen = window.sessionStorage.getItem("cog-work-log-main-help-seen");
    if (!seen) {
      mainHelpPanel.style.display = "block";
      window.sessionStorage.setItem("cog-work-log-main-help-seen", "1");
    }
    mainHelpClose.addEventListener("click", () => {
      mainHelpPanel.style.display = "none";
    });
  }

  // Atajos de teclado globales para el panel operativo
  window.addEventListener("keydown", (e) => {
    const target = e.target || document.activeElement;
    const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
    const isTypingField =
      tag === "input" || tag === "textarea" || target.isContentEditable;

    // Ctrl+K: ir a lista de tareas y enfocar búsqueda
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setView("view-tasks");
      const searchInput = document.getElementById("tasks-search");
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      return;
    }

    if (isTypingField) return;

    // Alt+1..5: cambiar de vista rápida
    if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
      switch (e.key) {
        case "1":
          setView("view-dashboard");
          break;
        case "2":
          setView("view-myday");
          break;
        case "3":
          if (currentUser && currentUser.role === "empleado") {
            setView("view-tasks");
          } else {
            setView("view-team");
          }
          break;
        case "4":
          setView("view-tasks");
          break;
        case "5":
          setView("view-profile");
          break;
        default:
          return;
      }
    }
  });
}

function applyRoleRestrictions() {
  if (!currentUser) return;

  if (currentUser.role === "empleado") {
    const teamNav = document.querySelector('.nav-item[data-view="team"]');
    if (teamNav) teamNav.style.display = "none";

    document
      .querySelectorAll('[data-view="team"].ghost-link')
      .forEach((btn) => (btn.style.display = "none"));

    [
      "btn-add-employee",
      "btn-edit-employee",
      "btn-delete-employee",
      "btn-assign-task-from-employee",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
  }
}

function applySavedTheme() {
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY) || "light";
  if (saved === "dark") {
    document.body.classList.add("theme-dark");
  } else {
    document.body.classList.remove("theme-dark");
  }
}

function setupThemeToggleMain() {
  const btn = document.getElementById("theme-toggle-main");
  if (!btn) return;

  const syncIcon = () => {
    const isDark = document.body.classList.contains("theme-dark");
    btn.innerHTML = isDark ? "&#9790;" : "&#9728;";
  };

  syncIcon();

  btn.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("theme-dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, isDark ? "dark" : "light");
    syncIcon();
  });
}

window.addEventListener("DOMContentLoaded", () => {
  if (!isAuthenticated()) {
    window.location.href = "login.html";
    return;
  }

  (async function initOperations() {
    applySavedTheme();
    setupThemeToggleMain();
    setupCrossTabLogoutMain();
    updateOperationsLastSyncLabel();
    await syncOperationsStateFromBackendIfAvailable();
    loadState();
    setupEvents();
  if (typeof getCurrentUser === "function") {
    currentUser = getCurrentUser();
  } else {
    const storedName =
      window.localStorage.getItem("cog-work-log-auth-name") || "Alejandro Torres";
    currentUser = { name: storedName, role: "empleado" };
  }

  const nameSpan = document.querySelector(".topbar-user-name");
  const roleSpan = document.querySelector(".topbar-user-role");
  const avatarEl = document.querySelector(".topbar-user-avatar");

  const { user: profileUser } = findCurrentUserRecordForProfile();

  if (nameSpan) nameSpan.textContent = currentUser.name;
  if (roleSpan) {
    let roleLabel = "Operador";
    if (currentUser.role === "admin") roleLabel = "Administrador";
    else if (currentUser.role === "jefe_estacion") roleLabel = "Jefe de estación";
    roleSpan.textContent = roleLabel;
  }
  if (avatarEl) {
    avatarEl.style.backgroundImage = "";
    avatarEl.textContent = getInitials(currentUser.name);
    if (profileUser && profileUser.photoUrl) {
      avatarEl.style.backgroundImage = `url(${profileUser.photoUrl})`;
      avatarEl.style.backgroundSize = "cover";
      avatarEl.style.backgroundPosition = "center";
      avatarEl.textContent = "";
    }
  }

  const welcomeAccent = document.querySelector(
    "#view-dashboard .view-header .accent"
  );
  if (welcomeAccent) {
    welcomeAccent.textContent = currentUser.name;
  }

  if (currentUser.role === "empleado") {
    const emp = state.employees.find(
      (e) => e.name.toLowerCase() === currentUser.name.toLowerCase()
    );
    if (emp) {
      state.selectedEmployeeId = emp.id;
      const tasksNav = document.querySelector('.nav-item[data-view="tasks"]');
      if (tasksNav) tasksNav.textContent = "Mis tareas";
      const tasksHeader = document.querySelector("#view-tasks .view-header h1");
      if (tasksHeader) tasksHeader.textContent = "Mis tareas";
    }
  }

  renderDashboard();
  setView("view-dashboard");
  initEmployeeCalendar();
  applyRoleRestrictions();

  const opsSyncBtn = document.getElementById("operations-sync-btn");
  if (opsSyncBtn) {
    opsSyncBtn.addEventListener("click", async () => {
      opsSyncBtn.disabled = true;
      try {
        await syncOperationsStateFromBackendIfAvailable();
        loadState();
        renderDashboard();
        renderTasksList();
        renderEmployeeDetail();
        if (employeeCalendar) {
          refreshEmployeeCalendarEvents();
        }
        showToast("Datos sincronizados desde el servidor", "success");
      } catch (e) {
        console.error("Error al sincronizar operations-state manualmente", e);
        showToast("No se pudo sincronizar datos desde el servidor", "error");
      } finally {
        opsSyncBtn.disabled = false;
      }
    });
  }
  })();
});

function buildEmployeeEvents() {
  const events = [];
  let tasks = [...state.tasks];

  if (currentUser && currentUser.role === "empleado") {
    let scopedIds = [];
    if (state.selectedEmployeeId) {
      scopedIds = [state.selectedEmployeeId];
    } else {
      scopedIds = state.employees
        .filter(
          (e) => e.name && e.name.toLowerCase() === currentUser.name.toLowerCase()
        )
        .map((e) => e.id);
    }
    if (scopedIds.length) {
      const idSet = new Set(scopedIds);
      tasks = tasks.filter((t) => idSet.has(t.employeeId));
    } else {
      tasks = [];
    }
  }

  tasks.forEach((t) => {
    const emp = findEmployee(t.employeeId);
    const freq = t.frequency || "unica";
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

    const baseTitle = emp ? `${emp.name}: ${t.title}` : t.title;
    const title = freqLabel ? `[${freqLabel}] ${baseTitle}` : baseTitle;
    const dateStr = t.dueDate || "";
    const timeStr = t.dueTime || "00:00";
    const start = dateStr ? `${dateStr}T${timeStr}` : undefined;

    let color = "#22c55e";
    if (t.status === STATUS.PENDING) color = "#f97316";
    if (t.status === STATUS.IN_PROGRESS) color = "#3b82f6";

    events.push({
      id: `task-${t.id}`,
      title,
      start,
      extendedProps: {
        type: "task",
        status: t.status,
        description: t.description,
        frequency: freq,
      },
      backgroundColor: color,
      borderColor: color,
    });
  });

  return events;
}

function initEmployeeCalendar() {
  const el = document.getElementById("employee-calendar");
  if (!el || typeof FullCalendar === "undefined") return;

  employeeCalendar = new FullCalendar.Calendar(el, {
    initialView: "dayGridMonth",
    height: "100%",
    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,timeGridWeek,timeGridDay",
    },
    events: buildEmployeeEvents(),
    eventClick: (info) => {
      const id = info.event.id || "";
      if (id.startsWith("task-")) {
        const raw = id.replace("task-", "");
        openActivityModal(raw);
      }
    },
  });

  employeeCalendar.render();
}

function refreshEmployeeCalendarEvents() {
  if (!employeeCalendar) return;
  employeeCalendar.removeAllEvents();
  const events = buildEmployeeEvents();
  events.forEach((e) => employeeCalendar.addEvent(e));
}
