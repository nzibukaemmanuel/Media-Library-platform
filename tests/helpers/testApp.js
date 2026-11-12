// Shared setup for the API tests.
//
// IMPORTANT: require this file BEFORE anything from src/. It points the app
// at a separate test database and a throwaway upload folder, and the app
// reads those settings when it is first loaded.
//
//   - Database: TEST_DB_NAME (default "media_library_test"), created on demand.
//     The name must end in "_test" so the tests can never touch real data.
//   - Uploads:  a fresh temporary folder, deleted afterwards.

require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');

const TEST_DB = process.env.TEST_DB_NAME || 'media_library_test';
if (!/_test$/.test(TEST_DB)) {
  throw new Error(`Refusing to run tests against "${TEST_DB}": the test database name must end in "_test"`);
}

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-tests-'));

// Must happen before src/config/db.js is loaded (dotenv does not override these)
process.env.DB_NAME = TEST_DB;
process.env.UPLOAD_DIR = uploadDir;
process.env.NODE_ENV = 'test';

// Create the test database if it does not exist yet
const ensureDatabase = async () => {
  const admin = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'postgres',
  });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (rowCount === 0) await admin.query(`CREATE DATABASE "${TEST_DB}"`); // name is validated above
  } finally {
    await admin.end();
  }
};

// Load the app only now that the environment is set
const loadApp = () => ({
  app: require('../../src/app'),
  pool: require('../../src/config/db').pool,
});

// Start the real app on a random port. Returns helpers for the tests.
const startTestApp = async () => {
  await ensureDatabase();
  const { app, pool } = loadApp();
  await pool.query(fs.readFileSync(path.join(__dirname, '../../src/database/schema.sql'), 'utf8'));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://localhost:${server.address().port}`;

  // JSON request -> { status, body }
  const request = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  // multipart upload -> { status, body }
  const upload = async ({ name = 'photo.png', type = 'image/png', content = 'fake-image-bytes', fields = {} } = {}) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append('file', new Blob([content], { type }), name);
    const res = await fetch(`${base}/api/media`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
  };

  // Empty the table and the upload folder so every test starts clean
  const reset = async () => {
    await pool.query('TRUNCATE media_assets RESTART IDENTITY');
    for (const file of fs.readdirSync(uploadDir)) fs.rmSync(path.join(uploadDir, file), { force: true });
  };

  const stop = async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
    await pool.end();
    fs.rmSync(uploadDir, { recursive: true, force: true });
  };

  return {
    base,
    pool,
    uploadDir,
    request,
    upload,
    reset,
    stop,
    filesOnDisk: () => fs.readdirSync(uploadDir),
  };
};

module.exports = { startTestApp, TEST_DB };
