const { Pool } = require('pg');

let pool = null;
let initialized = false;

function getPool() {
  if (pool) return pool;
  const connStr = process.env.DATABASE_URL;
  if (!connStr) return null;

  pool = new Pool({
    connectionString: connStr,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  });
  return pool;
}

async function init() {
  const p = getPool();
  if (!p || initialized) return;
  await p.query(`CREATE TABLE IF NOT EXISTS app_state (
    key text PRIMARY KEY,
    payload jsonb NOT NULL
  )`);
  initialized = true;
}

async function getJson(key) {
  const p = getPool();
  if (!p) return null;
  const res = await p.query('SELECT payload FROM app_state WHERE key = $1', [key]);
  if (!res.rows.length) return null;
  return res.rows[0].payload;
}

async function saveJson(key, payload) {
  const p = getPool();
  if (!p) return false;
  await p.query(
    'INSERT INTO app_state(key, payload) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload',
    [key, payload]
  );
  return true;
}

function hasDatabase() {
  return !!getPool();
}

module.exports = {
  init,
  getJson,
  saveJson,
  hasDatabase,
};
