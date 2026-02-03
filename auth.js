const AUTH_KEY = "cog-work-log-auth";

function isAuthenticated() {
  return window.localStorage.getItem(AUTH_KEY) === "1";
}

function setAuthenticated(name, role, area, username) {
  window.localStorage.setItem(AUTH_KEY, "1");
  if (name) {
    window.localStorage.setItem(`${AUTH_KEY}-name`, name);
  }
  if (role) {
    window.localStorage.setItem(`${AUTH_KEY}-role`, role);
  }
  if (area) {
    window.localStorage.setItem(`${AUTH_KEY}-area`, area);
  }
  if (username) {
    window.localStorage.setItem(`${AUTH_KEY}-username`, username);
  }
}

function clearAuth() {
  window.localStorage.removeItem(AUTH_KEY);
  window.localStorage.removeItem(`${AUTH_KEY}-name`);
  window.localStorage.removeItem(`${AUTH_KEY}-role`);
  window.localStorage.removeItem(`${AUTH_KEY}-stationId`);
  window.localStorage.removeItem(`${AUTH_KEY}-area`);
  window.localStorage.removeItem(`${AUTH_KEY}-username`);
}

function getCurrentUser() {
  const name =
    window.localStorage.getItem(`${AUTH_KEY}-name`) || "Usuario";
  const role =
    window.localStorage.getItem(`${AUTH_KEY}-role`) || "empleado";
  const stationId =
    window.localStorage.getItem(`${AUTH_KEY}-stationId`) || "";
  const area =
    window.localStorage.getItem(`${AUTH_KEY}-area`) || "";
  const username =
    window.localStorage.getItem(`${AUTH_KEY}-username`) || "";
  return { name, role, stationId, area, username };
}
