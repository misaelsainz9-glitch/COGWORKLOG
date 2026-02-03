const fs = require('fs');
const path = require('path');

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(msg);
}

function main() {
  const argPath = process.argv[2];
  if (!argPath) {
    log('Uso: node import-backup.js ruta/al/respaldo.json');
    process.exit(1);
  }

  const backupPath = path.isAbsolute(argPath)
    ? argPath
    : path.join(process.cwd(), argPath);

  if (!fs.existsSync(backupPath)) {
    log(`No se encontró el archivo de respaldo: ${backupPath}`);
    process.exit(1);
  }

  log(`Leyendo respaldo desde: ${backupPath}`);

  let raw;
  try {
    raw = fs.readFileSync(backupPath, 'utf8');
  } catch (e) {
    log('No se pudo leer el archivo de respaldo');
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    log('El archivo de respaldo no contiene JSON válido');
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  }

  const admin = parsed.admin || {};
  const operations = parsed.operations || {};

  // Preparar admin-data.json
  const adminState = {
    version: typeof admin.version === 'number' ? admin.version : 7,
    stations: Array.isArray(admin.stations) ? admin.stations : [],
    logs: Array.isArray(admin.logs) ? admin.logs : [],
    generalLogs: Array.isArray(admin.generalLogs) ? admin.generalLogs : [],
    users: Array.isArray(admin.users) ? admin.users : [],
    shifts: Array.isArray(admin.shifts) ? admin.shifts : [],
  };

  // Preparar operations-data.json
  const operationsState = {
    employees: Array.isArray(operations.employees)
      ? operations.employees
      : [],
    tasks: Array.isArray(operations.tasks) ? operations.tasks : [],
    lastTaskId:
      typeof operations.lastTaskId === 'number' ? operations.lastTaskId : 0,
    dataVersion:
      typeof operations.dataVersion === 'number' ? operations.dataVersion : 1,
  };

  // Preparar users.json a partir de admin.users (solo los que tengan username)
  const usersFromAdmin = Array.isArray(adminState.users)
    ? adminState.users
    : [];

  const simpleUsers = usersFromAdmin
    .filter((u) => u && u.username)
    .map((u) => ({
      username: u.username,
      password: u.password || '',
      name: u.name || u.username,
      role: u.role || 'empleado',
      area: u.area || '',
      passwordLastChanged: u.passwordLastChanged || null,
    }));

  const baseDir = __dirname;
  const adminDataPath = path.join(baseDir, 'admin-data.json');
  const operationsDataPath = path.join(baseDir, 'operations-data.json');
  const usersPath = path.join(baseDir, 'users.json');

  try {
    fs.writeFileSync(adminDataPath, JSON.stringify(adminState, null, 2), 'utf8');
    log(`Se escribió admin-data.json con ${adminState.logs.length} logs, ${adminState.generalLogs.length} bitácoras generales y ${adminState.users.length} usuarios.`);
  } catch (e) {
    log('No se pudo escribir admin-data.json');
    // eslint-disable-next-line no-console
    console.error(e);
  }

  try {
    fs.writeFileSync(
      operationsDataPath,
      JSON.stringify(operationsState, null, 2),
      'utf8'
    );
    log(
      `Se escribió operations-data.json con ${operationsState.employees.length} empleados y ${operationsState.tasks.length} tareas.`,
    );
  } catch (e) {
    log('No se pudo escribir operations-data.json');
    // eslint-disable-next-line no-console
    console.error(e);
  }

  try {
    if (simpleUsers.length) {
      fs.writeFileSync(usersPath, JSON.stringify(simpleUsers, null, 2), 'utf8');
      log(`Se escribió users.json con ${simpleUsers.length} usuarios.`);
    } else {
      log('No se generó users.json porque no se encontraron usuarios con username en el respaldo.');
    }
  } catch (e) {
    log('No se pudo escribir users.json');
    // eslint-disable-next-line no-console
    console.error(e);
  }

  log('Importación de respaldo terminada.');
}

main();
