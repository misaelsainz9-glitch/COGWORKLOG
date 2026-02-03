const fs = require('fs');
const path = require('path');

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTime(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function choice(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

function generateAdminData() {
  const now = new Date();
  const daysBack = 365 * 2; // últimos 2 años

  const stations = [
    {
      id: 'st1',
      name: 'Gasolinera Norte',
      location: 'Monterrey, N.L.',
      description: 'Gasolinera urbana · Turnos 24h · Zona norte',
      employees: [
        { name: 'Jefe Norte', role: 'Encargado · Jefe de estación' },
        { name: 'Operador Norte 1', role: 'Operador · Área Operación' },
        { name: 'Operador Norte 2', role: 'Operador · Área Operación' },
        { name: 'Operador Norte 3', role: 'Operador · Área Operación' },
      ],
    },
    {
      id: 'st2',
      name: 'Gasolinera Sur',
      location: 'Monterrey, N.L.',
      description: 'Gasolinera urbana · Turnos 24h · Zona sur',
      employees: [
        { name: 'Jefe Sur', role: 'Encargado · Jefe de estación' },
        { name: 'Operador Sur 1', role: 'Operador · Área Operación' },
        { name: 'Operador Sur 2', role: 'Operador · Área Operación' },
        { name: 'Operador Sur 3', role: 'Operador · Área Operación' },
      ],
    },
  ];

  const users = [
    {
      username: 'admin',
      password: 'admin123',
      name: 'Administrador',
      role: 'admin',
      area: 'Administración',
      passwordLastChanged: '2025-01-01T00:00:00.000Z',
    },
    {
      username: 'jefe_norte',
      password: 'jefe123',
      name: 'Jefe Norte',
      role: 'jefe_estacion',
      area: 'Operación',
      passwordLastChanged: '2025-01-01T00:00:00.000Z',
      stationId: 'st1',
    },
    {
      username: 'jefe_sur',
      password: 'jefe123',
      name: 'Jefe Sur',
      role: 'jefe_estacion',
      area: 'Operación',
      passwordLastChanged: '2025-01-01T00:00:00.000Z',
      stationId: 'st2',
    },
    {
      username: 'operador_norte',
      password: 'operador123',
      name: 'Operador Norte 1',
      role: 'empleado',
      area: 'Operación',
      passwordLastChanged: '2025-01-01T00:00:00.000Z',
    },
    {
      username: 'operador_sur',
      password: 'operador123',
      name: 'Operador Sur 1',
      role: 'empleado',
      area: 'Operación',
      passwordLastChanged: '2025-01-01T00:00:00.000Z',
    },
  ];

  const logs = [];
  let logId = 1;

  const shiftOptions = ['matutino', 'vespertino', 'nocturno'];
  const statusOptions = ['ok', 'warning', 'error'];
  const incidentTypes = [
    'Checklist apertura',
    'Ronda de arranque',
    'Ronda nocturna',
    'Falla de luminaria',
    'Derrame menor',
    'Recepción de pipa',
    'Mantenimiento preventivo',
  ];

  for (let d = 0; d <= daysBack; d++) {
    const date = new Date(now);
    date.setDate(now.getDate() - d);
    const dateStr = formatDate(date);

    stations.forEach((st) => {
      const logsToday = randomInt(0, 3); // 0-3 registros por estación por día
      for (let i = 0; i < logsToday; i++) {
        const shift = choice(shiftOptions);
        const statusRoll = Math.random();
        let status = 'ok';
        if (statusRoll > 0.8) status = 'warning';
        if (statusRoll > 0.93) status = 'error';

        const incidentType = choice(incidentTypes);
        let severity = 'baja';
        if (status === 'warning') severity = 'media';
        if (status === 'error') severity = 'alta';

        const hour = shift === 'matutino' ? randomInt(6, 13) : shift === 'vespertino' ? randomInt(14, 21) : randomInt(22, 23);
        const minute = randomInt(0, 59);
        const timeDate = new Date(date);
        timeDate.setHours(hour, minute, 0, 0);

        const userName = st.id === 'st1' ? choice(['Jefe Norte', 'Operador Norte 1', 'Operador Norte 2', 'Operador Norte 3']) : choice(['Jefe Sur', 'Operador Sur 1', 'Operador Sur 2', 'Operador Sur 3']);

        const log = {
          id: logId++,
          stationId: st.id,
          user: userName,
          entry: incidentType,
          description: '',
          date: dateStr,
          time: formatTime(timeDate),
          status,
          frequency: 'diaria',
          shift,
          incidentType,
          severity,
        };

        if (incidentType === 'Checklist apertura') {
          log.description = 'Checklist de apertura completado.';
        } else if (incidentType === 'Ronda de arranque') {
          log.description = 'Ronda de inicio de turno sin novedades graves.';
        } else if (incidentType === 'Ronda nocturna') {
          log.description = 'Ronda de seguridad nocturna realizada.';
        } else if (incidentType === 'Falla de luminaria') {
          log.description = 'Se detecta luminaria apagada en zona de descarga.';
        } else if (incidentType === 'Derrame menor') {
          log.description = 'Derrame menor controlado con kit de derrames.';
        } else if (incidentType === 'Recepción de pipa') {
          const liters = randomInt(15000, 25000);
          const fuelType = Math.random() < 0.5 ? 'Magna' : 'Diésel';
          log.description = `Recepción de pipa de ${fuelType} (${liters} L).`;
          log.fuelDelivery = {
            type: fuelType,
            liters,
            supplier: 'Proveedor Demo',
            ticket: `TK-${st.id}-${log.id}`,
          };
        } else if (incidentType === 'Mantenimiento preventivo') {
          log.description = 'Se realiza mantenimiento preventivo a equipo crítico.';
        }

        if (status !== 'ok') {
          log.approvalStatus = 'pendiente';
        }

        logs.push(log);
      }
    });
  }

  const generalLogs = [
    {
      id: 1,
      user: 'Administrador',
      role: 'admin',
      activity: 'Inicialización de datos demo',
      description: 'Se generó historial de 2 años para estaciones Norte y Sur.',
      date: formatDate(now),
      time: formatTime(now),
      status: 'ok',
      username: 'admin',
    },
  ];

  return {
    version: 7,
    stations,
    logs,
    generalLogs,
    users,
    shifts: [],
  };
}

function generateOperationsData() {
  const now = new Date();

  const employees = [
    {
      id: 'e1',
      name: 'Jefe Norte',
      role: 'Jefe de estación',
      station: 'Gasolinera Norte · Monterrey, N.L.',
      area: 'Operación',
    },
    {
      id: 'e2',
      name: 'Jefe Sur',
      role: 'Jefe de estación',
      station: 'Gasolinera Sur · Monterrey, N.L.',
      area: 'Operación',
    },
    {
      id: 'e3',
      name: 'Operador Norte 1',
      role: 'Operador de bomba',
      station: 'Gasolinera Norte · Monterrey, N.L.',
      area: 'Operación',
    },
    {
      id: 'e4',
      name: 'Operador Norte 2',
      role: 'Operador de bomba',
      station: 'Gasolinera Norte · Monterrey, N.L.',
      area: 'Operación',
    },
    {
      id: 'e5',
      name: 'Operador Norte 3',
      role: 'Operador de bomba',
      station: 'Gasolinera Norte · Monterrey, N.L.',
      area: 'Operación',
    },
    {
      id: 'e6',
      name: 'Operador Sur 1',
      role: 'Operador de bomba',
      station: 'Gasolinera Sur · Monterrey, N.L.',
      area: 'Operación',
    },
    {
      id: 'e7',
      name: 'Operador Sur 2',
      role: 'Operador de bomba',
      station: 'Gasolinera Sur · Monterrey, N.L.',
      area: 'Operación',
    },
    {
      id: 'e8',
      name: 'Operador Sur 3',
      role: 'Operador de bomba',
      station: 'Gasolinera Sur · Monterrey, N.L.',
      area: 'Operación',
    },
  ];

  const tasks = [];
  let taskId = 1;

  const statusOptions = ['pendiente', 'en_progreso', 'completada'];
  const freqOptions = ['diaria', 'semanal', 'mensual'];

  const monthsBack = 12; // tareas del último año

  for (let m = 0; m <= monthsBack; m++) {
    const baseDate = new Date(now.getFullYear(), now.getMonth() - m, 15);
    const tasksThisMonth = randomInt(5, 12);

    for (let i = 0; i < tasksThisMonth; i++) {
      const due = new Date(baseDate);
      due.setDate(randomInt(1, 28));
      const dueDate = formatDate(due);
      const dueTime = `${String(randomInt(6, 21)).padStart(2, '0')}:${String(randomInt(0, 59)).padStart(2, '0')}`;

      const employee = choice(employees);
      const status = choice(statusOptions);
      const freq = choice(freqOptions);

      const titles = [
        'Checklist apertura',
        'Ronda de seguridad',
        'Verificar extintores',
        'Revisión de islas',
        'Seguimiento incidente',
        'Mantenimiento menor',
      ];

      const title = choice(titles);

      tasks.push({
        id: taskId++,
        title,
        description: `${title} asignada a ${employee.name}.`,
        employeeId: employee.id,
        status,
        dueDate,
        dueTime,
        frequency: freq,
        createdAt: new Date(due.getFullYear(), due.getMonth(), due.getDate() - 3).toISOString(),
        priority: Math.random() > 0.7 ? 'alta' : 'media',
      });
    }
  }

  return {
    employees,
    tasks,
    lastTaskId: taskId - 1,
    dataVersion: 8,
  };
}

function main() {
  const adminData = generateAdminData();
  const operationsData = generateOperationsData();

  const baseDir = __dirname;
  const adminPath = path.join(baseDir, 'admin-data.json');
  const operationsPath = path.join(baseDir, 'operations-data.json');

  fs.writeFileSync(adminPath, JSON.stringify(adminData, null, 2), 'utf8');
  fs.writeFileSync(operationsPath, JSON.stringify(operationsData, null, 2), 'utf8');

  console.log(`Generados admin-data.json (logs: ${adminData.logs.length}) y operations-data.json (tareas: ${operationsData.tasks.length}).`);
}

main();
