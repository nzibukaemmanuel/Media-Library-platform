// Tests for the lab's structural rules. They read the source files and check
// them, so a rule that is broken later (a controller importing the database,
// a .then() chain, SQL in a service...) fails here with a clear message.
//
// These need no database, so they do not use the shared test app.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// ---------- helpers ----------

const listFiles = (dir) =>
  fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(dir, f));

const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

// Source without comments, so a rule is not tripped by prose such as "no .then() chains"
const code = (file) =>
  fs
    .readFileSync(file, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// What a file requires, as project-relative paths (src/services/x) or package names (express)
const requires = (file) =>
  [...code(file).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(([, spec]) => {
    if (!spec.startsWith('.')) return spec.replace(/^node:/, 'node:');
    return rel(path.resolve(path.dirname(file), spec)).replace(/\.js$/, '');
  });

const layerFiles = (layer) => listFiles(path.join(SRC, layer));
const inLayer = (spec, layer) => spec.startsWith(`src/${layer}/`) || spec === `src/${layer}`;

describe('Project structure (the lab brief)', () => {
  describe('layers exist', () => {
    for (const dir of ['routes', 'controllers', 'services', 'repositories', 'middlewares', 'models', 'config']) {
      it(`src/${dir}/ has code in it`, () => {
        const files = layerFiles(dir);
        assert.ok(files.length > 0, `src/${dir} is empty`);
        for (const file of files) assert.ok(fs.statSync(file).size > 0, `${rel(file)} is an empty file`);
      });
    }

    it('has the files the brief suggests', () => {
      for (const f of [
        'src/config/db.js',
        'src/controllers/mediaController.js',
        'src/services/mediaService.js',
        'src/repositories/mediaRepository.js',
        'src/routes/mediaRoutes.js',
        'src/middlewares/errorHandler.js',
        'src/middlewares/validate.js',
        'src/middlewares/upload.js',
        'src/models/Media.js',
        'src/utils/AppError.js',
        'src/utils/catchAsync.js',
        'src/app.js',
        'server.js',
      ]) {
        assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is missing`);
      }
    });
  });

  describe('layer boundaries: routes -> controllers -> services -> repositories', () => {
    it('route files only wire URLs to middleware and controllers', () => {
      for (const file of layerFiles('routes')) {
        const deps = requires(file);
        for (const dep of deps) {
          assert.ok(!inLayer(dep, 'services'), `${rel(file)} must not use a service (${dep})`);
          assert.ok(!inLayer(dep, 'repositories'), `${rel(file)} must not use a repository (${dep})`);
          assert.ok(!inLayer(dep, 'models'), `${rel(file)} must not use a model (${dep})`);
          assert.notEqual(dep, 'pg');
        }
      }
    });

    it('route files contain no business logic: no handlers, no async code', () => {
      for (const file of layerFiles('routes')) {
        const source = code(file);
        assert.doesNotMatch(source, /=>/, `${rel(file)} defines an inline handler`);
        assert.doesNotMatch(source, /\basync\b|\bawait\b/, `${rel(file)} contains async code`);
        assert.doesNotMatch(source, /\b(req|res)\./, `${rel(file)} touches the request or response`);
      }
    });

    it('controllers delegate to services: they never use repositories, models or the database', () => {
      for (const file of layerFiles('controllers')) {
        for (const dep of requires(file)) {
          assert.ok(!inLayer(dep, 'repositories'), `${rel(file)} must not use a repository (${dep})`);
          assert.ok(!inLayer(dep, 'models'), `${rel(file)} must not use a model (${dep})`);
          assert.ok(dep !== 'src/config/db' && dep !== 'pg', `${rel(file)} must not use the database (${dep})`);
        }
        assert.ok(requires(file).includes('src/services/mediaService'), `${rel(file)} should call the service`);
      }
    });

    it('services delegate database work to repositories: they never use pg or the pool', () => {
      for (const file of layerFiles('services')) {
        for (const dep of requires(file)) {
          assert.ok(dep !== 'src/config/db' && dep !== 'pg', `${rel(file)} must not use the database (${dep})`);
          assert.ok(!inLayer(dep, 'controllers') && !inLayer(dep, 'routes'), `${rel(file)} must not depend on a higher layer (${dep})`);
          assert.notEqual(dep, 'express');
        }
        assert.ok(requires(file).includes('src/repositories/mediaRepository'), `${rel(file)} should use the repository`);
      }
    });

    it('repositories depend only on the database, the model and constants', () => {
      for (const file of layerFiles('repositories')) {
        for (const dep of requires(file)) {
          assert.ok(!inLayer(dep, 'services') && !inLayer(dep, 'controllers') && !inLayer(dep, 'routes'), `${rel(file)} must not depend on a higher layer (${dep})`);
          assert.notEqual(dep, 'express');
        }
        assert.ok(requires(file).includes('src/config/db'), `${rel(file)} should use the database pool`);
      }
    });

    it('models depend on nothing but constants', () => {
      for (const file of layerFiles('models')) {
        for (const dep of requires(file)) assert.equal(dep, 'src/config/constants', `${rel(file)} requires ${dep}`);
      }
    });

    it('all SQL lives in the repositories (and the database setup)', () => {
      const sql = /\b(SELECT\s[\s\S]*?\sFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;
      const allowed = new Set(['src/config/db.js', 'src/database/initDb.js']); // startup check / schema script
      for (const file of listFiles(SRC)) {
        const name = rel(file);
        if (name.startsWith('src/repositories/') || allowed.has(name)) continue;
        assert.doesNotMatch(code(file), sql, `${name} contains SQL; it belongs in a repository`);
      }
    });
  });

  describe('async/await throughout (no .then() or .catch() chains)', () => {
    it('no source file uses .then() or .catch()', () => {
      const files = [...listFiles(SRC), path.join(ROOT, 'server.js')];
      const offenders = [];
      for (const file of files) {
        const source = code(file);
        if (/\.(then|catch)\s*\(/.test(source)) offenders.push(rel(file));
      }
      assert.deepEqual(offenders, [], 'these files use promise chains instead of async/await');
    });

    it('every controller is wrapped in catchAsync', () => {
      for (const file of layerFiles('controllers')) {
        const source = code(file);
        const exported = [...source.matchAll(/module\.exports\s*=\s*\{([\s\S]*?)\}/g)][0][1]
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean);
        assert.ok(exported.length > 0);
        for (const name of exported) {
          assert.match(source, new RegExp(String.raw`const ${name} = catchAsync\(async`), `${name} is not wrapped in catchAsync`);
        }
      }
    });

    it('uses Promise.all to fetch the records and the total count together', () => {
      const source = code(path.join(SRC, 'repositories', 'mediaRepository.js'));
      assert.match(source, /Promise\.all\(\s*\[[\s\S]*COUNT\(\*\)[\s\S]*SELECT \* FROM media_assets/);
    });
  });

  describe('global error handling', () => {
    const app = code(path.join(SRC, 'app.js'));

    it('registers the error handler last in the Express app', () => {
      const registrations = [...app.matchAll(/^app\.(use|get|post|put|patch|delete)\(/gm)];
      const lines = app.split('\n').filter((l) => /^app\.(use|get|post|put|patch|delete)\(/.test(l));
      assert.ok(registrations.length > 3);
      assert.equal(lines.at(-1).trim(), 'app.use(errorHandler);', 'errorHandler must be the last registration');
      assert.equal(lines.at(-2).trim(), 'app.use(notFound);');
    });

    it('has a reusable AppError class', () => {
      const AppError = require('../src/utils/AppError');
      const error = new AppError('Nope', 404);
      assert.ok(error instanceof Error);
      assert.equal(error.statusCode, 404);
      assert.equal(error.isOperational, true);
      assert.deepEqual(error.details, []);
    });

    it('registers handlers for unhandled rejections and uncaught exceptions', () => {
      const source = code(path.join(SRC, 'utils', 'processHandlers.js'));
      assert.match(source, /'unhandledRejection'/);
      assert.match(source, /'uncaughtException'/);
      assert.match(code(path.join(ROOT, 'server.js')), /registerProcessHandlers/);
    });
  });

  describe('dependencies the brief asks for', () => {
    it('are all installed and declared', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
      for (const name of ['express', 'multer', 'joi', 'dotenv', 'pg']) {
        assert.ok(pkg.dependencies[name], `${name} is not in dependencies`);
      }
    });

    it('keep uploads out of git', () => {
      const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
      assert.match(ignore, /^uploads\/$/m);
      assert.match(ignore, /^\.env$/m);
    });
  });
});
