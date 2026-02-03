const ADMIN_STORAGE_KEY = "cog-work-log-admin";
const THEME_STORAGE_KEY = "cog-work-log-theme";

// Configuración opcional de backend
const BACKEND_URL = "http://localhost:3001";
const BACKEND_LOGIN_ENABLED = true;

const LOGIN_ATTEMPTS_KEY = "cog-work-log-login-attempts";

function getLoginAttempts() {
  try {
    const raw = window.localStorage.getItem(LOGIN_ATTEMPTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.error("No se pudieron leer intentos de login", e);
    return {};
  }
}

function saveLoginAttempts(map) {
  try {
    window.localStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify(map || {}));
  } catch (e) {
    console.error("No se pudieron guardar intentos de login", e);
  }
}

async function tryBackendLogin(username, password, role) {
  if (!BACKEND_LOGIN_ENABLED || typeof fetch === "undefined") {
    return null;
  }

  try {
    const resp = await fetch(BACKEND_URL + "/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password, role }),
    });

    let data = null;
    try {
      data = await resp.json();
    } catch (e) {
      data = null;
    }

    if (!resp.ok || !data || data.ok === false) {
      const message =
        (data && (data.message || data.error)) ||
        "No se pudo iniciar sesión en el servidor.";
      return { ok: false, message };
    }

    return {
      ok: true,
      user: data.user || null,
      token: data.token || null,
    };
  } catch (e) {
    console.warn("No se pudo contactar backend de login", e);
    return null;
  }
}

function getAdminUsers() {
  const raw = window.localStorage.getItem(ADMIN_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch (e) {
    console.error("No se pudieron leer usuarios de administración", e);
    return [];
  }
}

function showToast(message, type = "error") {
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

window.addEventListener("DOMContentLoaded", () => {
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY) || "light";
  if (savedTheme === "dark") {
    document.body.classList.add("theme-dark");
  }

  const themeBtn = document.getElementById("login-theme-toggle");
  if (themeBtn) {
    const syncIcon = () => {
      const isDark = document.body.classList.contains("theme-dark");
      themeBtn.innerHTML = isDark ? "&#9790;" : "&#9728;";
    };
    syncIcon();

    themeBtn.addEventListener("click", () => {
      const isDark = document.body.classList.toggle("theme-dark");
      window.localStorage.setItem(THEME_STORAGE_KEY, isDark ? "dark" : "light");
      syncIcon();
    });
  }

  const loginHelpPanel = document.getElementById("login-help-panel");
  const loginHelpClose = document.getElementById("login-help-close");
  if (loginHelpPanel && loginHelpClose) {
    // Mostrar ayuda una sola vez por sesión de navegador
    const seen = window.sessionStorage.getItem("cog-work-log-login-help-seen");
    if (!seen) {
      loginHelpPanel.style.display = "block";
      window.sessionStorage.setItem("cog-work-log-login-help-seen", "1");
    }
    loginHelpClose.addEventListener("click", () => {
      loginHelpPanel.style.display = "none";
    });
  }

  const form = document.getElementById("login-form");
  if (!form) return;

  const roleSelect = document.getElementById("login-role");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("login-user");
    const passInput = document.getElementById("login-pass");
    const roleSelectSubmit = document.getElementById("login-role");

    const username = nameInput.value.trim();
    const password = passInput.value.trim();
    const role = roleSelectSubmit.value;
    const area = "";

    if (!password || !role) return;

    // Verificar bloqueos por intentos fallidos recientes
    const attempts = getLoginAttempts();
    const record = attempts[username] || { count: 0, last: 0 };
    const nowMs = Date.now();
    const windowMs = 10 * 60 * 1000; // 10 minutos

    if (record.count >= 5 && record.last && nowMs - record.last < windowMs) {
      showToast(
        "Cuenta temporalmente bloqueada por múltiples intentos fallidos. Intenta de nuevo en unos minutos.",
        "error"
      );

      // Registrar bloqueo por intentos fallidos en bitácora general
      try {
        const rawAdmin = window.localStorage.getItem(ADMIN_STORAGE_KEY);
        const adminData = rawAdmin ? JSON.parse(rawAdmin) : {};
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
          user: username || "desconocido",
          role: "sistema",
          activity: "Bloqueo temporal por intentos fallidos",
          description:
            "Usuario " +
            (username || "") +
            " superó el límite de intentos de inicio de sesión.",
          date,
          time,
          status: "error",
        });

        adminData.generalLogs = generalLogs;
        window.localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminData));
      } catch (e) {
        console.error("No se pudo registrar bloqueo por intentos fallidos", e);
      }

      return;
    }

    let fromBackend = false;
    let backendUser = null;

    // Intentar autenticación contra backend si está disponible
    const backendResult = await tryBackendLogin(username, password, role);
    if (backendResult && backendResult.ok) {
      fromBackend = true;
      backendUser = backendResult.user || null;
    } else if (backendResult && !backendResult.ok) {
      // Backend respondió pero con error de credenciales u otra validación
      showToast(backendResult.message || "No se pudo iniciar sesión.", "error");
      const next = {
        count: record.count + 1,
        last: nowMs,
      };
      attempts[username] = next;
      saveLoginAttempts(attempts);

      // Registrar intento fallido de backend en bitácora general
      try {
        const rawAdmin = window.localStorage.getItem(ADMIN_STORAGE_KEY);
        const adminData = rawAdmin ? JSON.parse(rawAdmin) : {};
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
          user: username || "desconocido",
          role: "sistema",
          activity: "Intento de inicio de sesión fallido (backend)",
          description:
            backendResult.message ||
            "Error de autenticación reportado por el servidor.",
          date,
          time,
          status: "error",
        });

        adminData.generalLogs = generalLogs;
        window.localStorage.setItem(
          ADMIN_STORAGE_KEY,
          JSON.stringify(adminData)
        );
      } catch (err) {
        console.error(
          "No se pudo registrar intento de login fallido (backend)",
          err
        );
      }

      return;
    }

    const adminUsers = getAdminUsers();
    let matchedUser = null;

    if (backendUser) {
      matchedUser = {
        username: backendUser.username || username,
        name: backendUser.name || username,
        role: backendUser.role || role,
        area: backendUser.area || "",
        passwordLastChanged: backendUser.passwordLastChanged || null,
      };
    }

    if (adminUsers.length && !fromBackend) {
      matchedUser = adminUsers.find((u) => u.username === username);
      if (!matchedUser) {
        showToast("Usuario no registrado en el módulo de administración.", "error");
        const next = {
          count: record.count + 1,
          last: nowMs,
        };
        attempts[username] = next;
        saveLoginAttempts(attempts);

        // Registrar intento fallido
        try {
          const rawAdmin = window.localStorage.getItem(ADMIN_STORAGE_KEY);
          const adminData = rawAdmin ? JSON.parse(rawAdmin) : {};
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
            user: username || "desconocido",
            role: "sistema",
            activity: "Intento de inicio de sesión fallido",
            description:
              "Usuario " +
              (username || "") +
              " no encontrado en el catálogo de administración.",
            date,
            time,
            status: "error",
          });

          adminData.generalLogs = generalLogs;
          window.localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminData));
        } catch (e) {
          console.error("No se pudo registrar intento de login fallido", e);
        }

        return;
      }
      if (matchedUser.password && matchedUser.password !== password) {
        showToast("Contraseña incorrecta.", "error");
        const next = {
          count: record.count + 1,
          last: nowMs,
        };
        attempts[username] = next;
        saveLoginAttempts(attempts);

        // Registrar intento fallido por contraseña
        try {
          const rawAdmin = window.localStorage.getItem(ADMIN_STORAGE_KEY);
          const adminData = rawAdmin ? JSON.parse(rawAdmin) : {};
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
            user: matchedUser.name || username || "desconocido",
            role: matchedUser.role || "sistema",
            activity: "Intento de inicio de sesión fallido",
            description:
              "Contraseña incorrecta para el usuario " +
              (matchedUser.username || "") +
              ".",
            date,
            time,
            status: "error",
          });

          adminData.generalLogs = generalLogs;
          window.localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminData));
        } catch (e) {
          console.error("No se pudo registrar intento de login fallido", e);
        }

        return;
      }
      if (matchedUser.role && matchedUser.role !== role) {
        showToast("El rol seleccionado no coincide con el usuario configurado.", "warning");
        const next = {
          count: record.count + 1,
          last: nowMs,
        };
        attempts[username] = next;
        saveLoginAttempts(attempts);

        // Registrar intento fallido por rol incorrecto
        try {
          const rawAdmin = window.localStorage.getItem(ADMIN_STORAGE_KEY);
          const adminData = rawAdmin ? JSON.parse(rawAdmin) : {};
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
            user: matchedUser.name || username || "desconocido",
            role: matchedUser.role || "sistema",
            activity: "Intento de inicio de sesión fallido",
            description:
              "Rol seleccionado (" +
              role +
              ") no coincide con el rol configurado (" +
              (matchedUser.role || "") +
              ").",
            date,
            time,
            status: "warning",
          });

          adminData.generalLogs = generalLogs;
          window.localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminData));
        } catch (e) {
          console.error("No se pudo registrar intento de login fallido", e);
        }

        return;
      }
    }

    const finalName = matchedUser ? matchedUser.name : username || "Invitado";
    const finalRole = matchedUser ? matchedUser.role : role;
    const finalArea = matchedUser ? matchedUser.area || "" : "";
    const finalUsername = matchedUser ? matchedUser.username : username;

    if (
      matchedUser &&
      matchedUser.role === "jefe_estacion" &&
      matchedUser.stationId
    ) {
      try {
        window.localStorage.setItem(
          AUTH_KEY + "-stationId",
          matchedUser.stationId
        );
      } catch (e) {
        console.error("No se pudo guardar estación asignada", e);
      }
    }

    // Login correcto: limpiar contador de intentos para este usuario
    if (attempts[username]) {
      delete attempts[username];
      saveLoginAttempts(attempts);
    }

    setAuthenticated(finalName, finalRole, finalArea, finalUsername);

    let mustChangePassword = false;

    // Caducidad de contraseña (más de 90 días)
    try {
      if (matchedUser && matchedUser.passwordLastChanged) {
        const last = new Date(matchedUser.passwordLastChanged);
        const diffMs = Date.now() - last.getTime();
        const days = diffMs / (1000 * 60 * 60 * 24);
        if (days > 90) {
          if (finalRole === "empleado") {
            // Para operadores solo mostramos advertencia
            showToast(
              "Tu contraseña tiene más de 90 días. Considera actualizarla desde 'Mi perfil'.",
              "warning"
            );
          } else {
            // Para roles de administración forzamos cambio de contraseña
            mustChangePassword = true;
            showToast(
              "Tu contraseña ha caducado. Debes actualizarla desde 'Mi perfil'.",
              "warning"
            );
          }
        }
      }
    } catch (e) {
      // silencioso
    }

    // Registrar inicio de sesión en la bitácora general del sistema
    try {
      const rawAdmin = window.localStorage.getItem(ADMIN_STORAGE_KEY);
      let adminData;
      if (rawAdmin) {
        try {
          adminData = JSON.parse(rawAdmin);
        } catch (err) {
          console.error("No se pudo parsear almacenamiento admin para sesión", err);
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

      generalLogs.push({
        id: nextId,
        user: finalName,
        role: finalRole,
        activity: "Inicio de sesión",
        description:
          "Usuario " + (finalUsername || finalName) + " inició sesión",
        date,
        time,
        status: "ok",
      });

      adminData.generalLogs = generalLogs;
      window.localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminData));
    } catch (err) {
      console.error("No se pudo registrar inicio de sesión en bitácora general", err);
    }

    // Marcar en sesión si es obligatorio cambiar la contraseña
    try {
      if (typeof AUTH_KEY !== "undefined") {
        if (mustChangePassword) {
          window.localStorage.setItem(`${AUTH_KEY}-mustChangePassword`, "1");
        } else {
          window.localStorage.removeItem(`${AUTH_KEY}-mustChangePassword`);
        }
      }
    } catch (e) {
      console.error("No se pudo actualizar la marca de cambio obligatorio de contraseña", e);
    }

    let target = "admin.html";
    if (finalRole === "empleado") {
      target = "index.html";
    }

    window.location.href = target;
  });
});
