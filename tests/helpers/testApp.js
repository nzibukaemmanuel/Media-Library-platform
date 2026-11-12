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
if (!TEST_DB.endsWith('_test')) {
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
  // A title is required by the API, so one is supplied unless the test passes
  // its own (or sets `fields.title` explicitly, even to '' or undefined-like values).
  const upload = async ({ name = 'photo.png', type = 'image/png', content = 'fake-image-bytes', fields = {} } = {}) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ title: 'Test upload', ...fields })) form.append(key, value);
    form.append('file', new Blob([content], { type }), name);
    const res = await fetch(`${base}/api/media`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
  };

  // Send a hand-built multipart form (for edge cases: several files, a wrong
  // field name, repeated fields...). `build` receives an empty FormData.
  const uploadForm = async (build) => {
    const form = new FormData();
    build(form);
    const res = await fetch(`${base}/api/media`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
  };

  // Insert rows straight into the database, for tests that need exact control
  // over values (sizes, dates, tags...) without uploading real files.
  // Returns the inserted rows, including their generated ids.
  const seed = async (rows) => {
    const inserted = [];
    for (const row of rows) {
      const data = {
        file_name: 'seed.png',
        original_name: 'seed.png',
        file_path: '/seed/seed.png',
        mime_type: 'image/png',
        media_type: 'image',
        file_size: 1,
        ...row,
      };
      const columns = Object.keys(data);
      const { rows: result } = await pool.query(
        `INSERT INTO media_assets (${columns.join(', ')})
         VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
        columns.map((c) => data[c])
      );
      inserted.push(result[0]);
    }
    return inserted;
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
    uploadForm,
    seed,
    reset,
    stop,
    filesOnDisk: () => fs.readdirSync(uploadDir),
    rowCount: async () => (await pool.query('SELECT count(*)::int AS n FROM media_assets')).rows[0].n,
  };
};

module.exports = { startTestApp, TEST_DB };
