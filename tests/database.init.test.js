const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Must be required before anything from src/ (creates the test database)
const { startTestApp, TEST_DB } = require('./helpers/testApp');

// npm run db:init, run for real in a child process
const ROOT = path.join(__dirname, '..');
const runInit = (env = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/database/initDb.js'], {
      cwd: ROOT,
      env: { ...process.env, DB_NAME: TEST_DB, ...env },
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill(), 20000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });

describe('npm run db:init (src/database/initDb.js)', () => {
  let t;
  before(async () => {
    t = await startTestApp(); // creates the test database and applies the schema once
  });
  after(async () => {
    await t.stop();
  });

  it('applies the schema and exits with code 0', async () => {
    const { code, output } = await runInit();
    assert.equal(code, 0, output);
    assert.match(output, /Database schema applied successfully/);
  });

  it('can be run again and again', async () => {
    for (let i = 0; i < 3; i++) assert.equal((await runInit()).code, 0);
  });

  it('keeps the existing data when run again', async () => {
    await t.reset();
    const [row] = await t.seed([{ title: 'Survives db:init', category: 'design' }]);
    assert.equal((await runInit()).code, 0);
    const { rows } = await t.pool.query('SELECT title, category FROM media_assets WHERE id = $1', [row.id]);
    assert.deepEqual(rows, [{ title: 'Survives db:init', category: 'design' }]);
  });

  it('creates the category column, its enum and its index', async () => {
    const column = await t.pool.query(
      "SELECT data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'media_assets' AND column_name = 'category'"
    );
    assert.equal(column.rows[0].data_type, 'USER-DEFINED');
    assert.match(column.rows[0].column_default, /'general'/);
    assert.equal(column.rows[0].is_nullable, 'NO');

    const values = await t.pool.query("SELECT unnest(enum_range(NULL::media_category))::text AS v");
    assert.deepEqual(values.rows.map((r) => r.v), ['general', 'marketing', 'design', 'documentation', 'reports', 'other']);

    const index = await t.pool.query("SELECT 1 FROM pg_indexes WHERE indexname = 'idx_media_assets_category'");
    assert.equal(index.rowCount, 1);
  });

  it('rejects a category the enum does not allow, at the database level', async () => {
    await assert.rejects(
      () => t.seed([{ title: 'bad', category: 'bogus' }]),
      (error) => error.code === '22P02'
    );
  });

  it('reports a clear error and exits with code 1 when the database is unreachable', async () => {
    const { code, output } = await runInit({ DB_PORT: '5999' });
    assert.equal(code, 1, output);
    assert.equal(output.match(/Failed to apply schema: ECONNREFUSED/g)?.length, 1, `exactly one clear error line:\n${output}`);
  });
});
