const { describe, it, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Must be required before anything from src/ (sets the test database)
const { startTestApp } = require('./helpers/testApp');

describe('Global error handling and API responses', () => {
  let t;
  let errorLog; // spy on console.error: what the server writes to its log

  before(async () => {
    t = await startTestApp();
  });
  after(async () => {
    await t.stop();
  });
  beforeEach(async () => {
    await t.reset();
    errorLog?.mock.restore();
    errorLog = mock.method(console, 'error', () => {}); // silence and record expected server errors
  });

  // ---- helpers ----

  // Any request, returning status, headers, raw text and parsed JSON
  const raw = async (method, url, { headers = {}, body } = {}) => {
    const res = await fetch(t.base + url, { method, headers, body });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, headers: res.headers, text, json };
  };
  const json = (method, url, payload) =>
    raw(method, url, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });

  // The shape every error must have, and what it must never contain
  const assertErrorEnvelope = (res, status) => {
    assert.equal(res.status, status, res.text.slice(0, 300));
    assert.match(res.headers.get('content-type'), /^application\/json/);
    assert.ok(res.json, `body must be JSON, got: ${res.text.slice(0, 100)}`);
    assert.equal(res.json.status, 'error');
    assert.equal(typeof res.json.message, 'string');
    assert.ok(res.json.message.length > 0);
    for (const key of Object.keys(res.json)) {
      assert.ok(['status', 'message', 'details', 'stack'].includes(key), `unexpected key "${key}" in an error response`);
    }
    assert.ok(Array.isArray(res.json.details), 'details is always present, empty when there are no field problems');
    for (const d of res.json.details) assert.deepEqual(Object.keys(d).sort(), ['field', 'message']);
    assert.equal('data' in res.json, false, 'errors never carry data');
    assert.doesNotMatch(res.text, /<html|<pre>/i, 'never an HTML page');
    assert.doesNotMatch(res.text, /node_modules|\bat\s+\S+\s+\(.*:\d+:\d+\)/, 'never a stack trace or internal path');
  };

  // Make the next database calls fail with `error`, run `fn`, then restore
  const withBrokenDb = async (error, fn) => {
    const original = t.pool.query;
    t.pool.query = async () => { throw error; };
    try {
      return await fn();
    } finally {
      t.pool.query = original;
    }
  };
  const pgError = (code, message = 'secret internal detail: relation "media_assets" column "title"') =>
    Object.assign(new Error(message), { code });
  const loggedErrors = () => errorLog.mock.calls.length;

  describe('unknown routes', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      it(`${method} on an unknown path returns a JSON 404 that names the route`, async () => {
        const res = await raw(method, '/api/nothing/here', method === 'GET' ? {} : { headers: { 'content-type': 'application/json' }, body: '{}' });
        assertErrorEnvelope(res, 404);
        assert.equal(res.json.message, `Route not found: ${method} /api/nothing/here`);
      });
    }

    it('returns 404 for a method the route does not support', async () => {
      // /api/media/:id supports GET, PATCH and DELETE, not PUT
      const res = await json('PUT', '/api/media/1', { title: 'x' });
      assertErrorEnvelope(res, 404);
    });

    it('names the full requested URL, including the query string', async () => {
      const res = await raw('GET', '/nope?x=1');
      assertErrorEnvelope(res, 404);
      assert.match(res.json.message, /GET \/nope\?x=1/);
    });

    it('is not logged as a server error', async () => {
      await raw('GET', '/nope');
      assert.equal(loggedErrors(), 0);
    });
  });

  describe('malformed requests', () => {
    it('rejects invalid JSON with 400', async () => {
      const res = await raw('PATCH', '/api/media/1', { headers: { 'content-type': 'application/json' }, body: '{"title": ' });
      assertErrorEnvelope(res, 400);
      assert.equal(res.json.message, 'Request body contains invalid JSON');
    });

    it('rejects JSON that is not an object or array', async () => {
      for (const body of ['"just a string"', '42', 'true', 'nul']) {
        const res = await raw('PATCH', '/api/media/1', { headers: { 'content-type': 'application/json' }, body });
        assertErrorEnvelope(res, 400);
      }
    });

    it('rejects a JSON array where an object is expected, without crashing', async () => {
      const res = await json('PATCH', '/api/media/1', [1, 2]);
      assertErrorEnvelope(res, 400);
    });

    it('rejects a body that is too large with 413', async () => {
      const res = await json('POST', '/api/media/bulk-delete', { ids: [1], padding: 'x'.repeat(200 * 1024) });
      assertErrorEnvelope(res, 413);
      assert.equal(res.json.message, 'Request body is too large');
    });

    it('rejects an unsupported charset with 415', async () => {
      const res = await raw('POST', '/api/media/bulk-delete', { headers: { 'content-type': 'application/json; charset=not-a-real-charset' }, body: '{}' });
      assertErrorEnvelope(res, 415);
    });

    it('treats a body with the wrong content type as no body (validation error, not a crash)', async () => {
      const res = await raw('PATCH', '/api/media/1', { headers: { 'content-type': 'text/plain' }, body: '{"title":"x"}' });
      assertErrorEnvelope(res, 400);
      assert.ok(res.json.details.some((d) => /at least one field/.test(d.message)), JSON.stringify(res.json));
    });

    it('handles an empty body on a route that needs one', async () => {
      assertErrorEnvelope(await raw('POST', '/api/media/bulk-delete'), 400);
      assertErrorEnvelope(await raw('POST', '/api/media/bulk-update'), 400);
      assertErrorEnvelope(await raw('PATCH', '/api/media/tags/rename'), 400);
    });

    it('is not logged as a server error', async () => {
      await raw('PATCH', '/api/media/1', { headers: { 'content-type': 'application/json' }, body: '{bad' });
      await json('POST', '/api/media/bulk-delete', { ids: [1], padding: 'x'.repeat(200 * 1024) });
      assert.equal(loggedErrors(), 0);
    });
  });

  describe('validation errors', () => {
    it('says "Validation failed" and lists every problem with its field', async () => {
      const res = await json('PATCH', '/api/media/abc', { title: '', colour: 'red' });
      assertErrorEnvelope(res, 400);
      assert.equal(res.json.message, 'Validation failed');
      // problems from the URL (id) and the body (title, colour) are reported together
      assert.deepEqual(res.json.details.map((d) => d.field).sort(), ['colour', 'id', 'title']);
    });

    it('writes each detail as a readable sentence starting with a capital', async () => {
      const res = await json('PATCH', '/api/media/abc', { title: '' });
      for (const d of res.json.details) assert.match(d.message, /^[A-Z]/, d.message);
      assert.ok(res.json.details.some((d) => d.field === 'id' && d.message === 'Id must be a number'));
    });

    it('reports query string problems by parameter name', async () => {
      const res = await raw('GET', '/api/media?page=0&sortBy=evil');
      assertErrorEnvelope(res, 400);
      assert.deepEqual(res.json.details.map((d) => d.field).sort(), ['page', 'sortBy']);
    });

    it('uses a null field for a problem with the request as a whole', async () => {
      const res = await raw('GET', '/api/media?page=2&offset=10');
      assertErrorEnvelope(res, 400);
      assert.ok(res.json.details.some((d) => d.field === null && /either page or offset/.test(d.message)), JSON.stringify(res.json.details));
    });

    it('has an empty details list for errors that are not field problems', async () => {
      const res = await raw('GET', '/api/media/999999');
      assertErrorEnvelope(res, 404);
      assert.deepEqual(res.json.details, []);
    });

    it('answers 400 for a bad id before it ever looks for the record', async () => {
      assertErrorEnvelope(await raw('GET', '/api/media/abc'), 400);
      assertErrorEnvelope(await raw('GET', '/api/media/999999'), 404);
    });

    it('is not logged as a server error', async () => {
      await raw('GET', '/api/media/abc');
      await raw('GET', '/api/media/999999');
      assert.equal(loggedErrors(), 0);
    });
  });

  describe('database errors', () => {
    const cases = [
      ['invalid value (22P02)', '22P02', 400, /Invalid value/],
      ['number out of range (22003)', '22003', 400, /out of range/],
      ['value too long (22001)', '22001', 400, /too long/],
      ['missing required value (23502)', '23502', 400, /required value is missing/],
      ['check constraint violated (23514)', '23514', 400, /not allowed/],
      ['duplicate record (23505)', '23505', 409, /already exists/],
      ['linked record (23503)', '23503', 409, /linked to other data/],
    ];
    for (const [label, code, status, pattern] of cases) {
      it(`maps ${label} to ${status} with a plain message and no SQL detail`, async () => {
        const res = await withBrokenDb(pgError(code), () => raw('GET', '/api/media/5'));
        assertErrorEnvelope(res, status);
        assert.match(res.json.message, pattern);
        assert.doesNotMatch(res.text, /secret internal detail|media_assets|column/);
        assert.equal(loggedErrors(), 0, 'a client-caused database error is not a server failure');
      });
    }

    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', '57P01', '08006']) {
      it(`maps ${code} (database unreachable) to 503 and logs it`, async () => {
        const res = await withBrokenDb(pgError(code, 'connect ECONNREFUSED 127.0.0.1:5432'), () => raw('GET', '/api/media'));
        assertErrorEnvelope(res, 503);
        assert.equal(res.json.message, 'The service is temporarily unavailable');
        assert.doesNotMatch(res.text, /127\.0\.0\.1|ECONN|5432/);
        assert.ok(loggedErrors() >= 1, 'a server failure must be logged');
      });
    }

    it('works again as soon as the database is back', async () => {
      await withBrokenDb(pgError('ECONNREFUSED'), () => raw('GET', '/api/media'));
      const res = await raw('GET', '/api/media');
      assert.equal(res.status, 200);
    });
  });

  describe('unexpected errors', () => {
    const bug = () => new TypeError("Cannot read properties of undefined (reading 'secretField')");

    it('returns a generic 500 without leaking the message', async () => {
      const res = await withBrokenDb(bug(), () => raw('GET', '/api/media/5'));
      assertErrorEnvelope(res, 500);
      assert.deepEqual(res.json, { status: 'error', message: 'Internal server error', details: [] });
      assert.doesNotMatch(res.text, /secretField|TypeError/);
    });

    it('logs the real error on the server', async () => {
      const error = bug();
      await withBrokenDb(error, () => raw('GET', '/api/media/5'));
      assert.ok(errorLog.mock.calls.some((c) => c.arguments.includes(error)), 'the original error must be logged');
      assert.ok(errorLog.mock.calls.some((c) => /GET \/api\/media\/5 -> 500/.test(String(c.arguments[0]))), 'with the request and status');
    });

    it('does not leak an error that claims to be a client error', async () => {
      const res = await withBrokenDb(Object.assign(new Error('internal path /srv/app/secret.js'), { status: 500 }), () => raw('GET', '/api/media/5'));
      assertErrorEnvelope(res, 500);
      assert.equal(res.json.message, 'Internal server error');
    });

    it('survives non-Error values being thrown', async () => {
      // Includes the values Express would treat as instructions rather than errors:
      // undefined/null/0/''/false mean "continue to the next handler" (-> a false 404)
      // and 'route'/'router' skip handlers
      for (const thrown of ['a string', 42, 0, '', false, null, undefined, { custom: true }, 'route', 'router']) {
        const original = t.pool.query;
        t.pool.query = async () => { throw thrown; };
        try {
          assertErrorEnvelope(await raw('GET', '/api/media/5'), 500);
        } finally {
          t.pool.query = original;
        }
      }
    });

    it('keeps serving requests after server errors', async () => {
      for (let i = 0; i < 5; i++) await withBrokenDb(bug(), () => raw('GET', '/api/media'));
      assert.equal((await raw('GET', '/api/health')).status, 200);
      assert.equal((await raw('GET', '/api/media')).status, 200);
    });

    it('fails cleanly in the middle of a multi-step operation', async () => {
      // upload: the file is stored, then the database insert fails -> the file must be removed
      const original = t.pool.query;
      t.pool.query = async (sql, ...rest) => (/INSERT INTO media_assets/.test(sql) ? Promise.reject(bug()) : original.call(t.pool, sql, ...rest));
      let res;
      try {
        res = await t.upload({ name: 'photo.png' });
      } finally {
        t.pool.query = original;
      }
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { status: 'error', message: 'Internal server error', details: [] });
      assert.deepEqual(t.filesOnDisk(), [], 'the stored file must not be left behind');
      assert.equal(await t.rowCount(), 0);
    });

    describe('in development', () => {
      const original = process.env.NODE_ENV;
      beforeEach(() => { process.env.NODE_ENV = 'development'; });
      afterEach(() => { process.env.NODE_ENV = original; });

      it('includes the stack for unexpected errors', async () => {
        const res = await withBrokenDb(bug(), () => raw('GET', '/api/media/5'));
        assert.equal(res.status, 500);
        assert.match(res.json.stack, /secretField/);
        assert.match(res.json.stack, /TypeError/);
      });

      it('still never includes a stack for client errors', async () => {
        for (const res of [await raw('GET', '/api/media/abc'), await raw('GET', '/api/media/999999'), await raw('GET', '/nope')]) {
          assert.equal('stack' in res.json, false);
        }
      });

      it('goes back to hiding the stack outside development', async () => {
        process.env.NODE_ENV = 'production';
        const res = await withBrokenDb(bug(), () => raw('GET', '/api/media/5'));
        assert.equal('stack' in res.json, false);
      });
    });
  });

  describe('success responses', () => {
    // Every success response is exactly { status: "success", data }
    const assertSuccessEnvelope = (res, status) => {
      assert.equal(res.status, status, res.text.slice(0, 300));
      assert.match(res.headers.get('content-type'), /^application\/json/);
      assert.equal(res.json.status, 'success');
      assert.deepEqual(Object.keys(res.json).sort(), ['data', 'status']);
    };

    it('uses the same format on every endpoint', async () => {
      assertSuccessEnvelope(await raw('GET', '/'), 200);
      assertSuccessEnvelope(await raw('GET', '/api/health'), 200);

      const created = await t.upload({ fields: { tags: 'a,b' } });
      assert.equal(created.status, 201);
      const id = created.body.data.id;
      const second = (await t.upload({ fields: { tags: 'b' } })).body.data.id;
      const wrap = (r) => ({ status: r.status, headers: new Headers({ 'content-type': 'application/json' }), json: r.body, text: JSON.stringify(r.body) });
      assertSuccessEnvelope(wrap(created), 201);

      assertSuccessEnvelope(await raw('GET', '/api/media'), 200);
      assertSuccessEnvelope(await raw('GET', `/api/media/${id}`), 200);
      assertSuccessEnvelope(await json('PATCH', `/api/media/${id}`, { title: 'new' }), 200);
      assertSuccessEnvelope(await json('POST', `/api/media/${id}/tags`, { tags: ['c'] }), 200);
      assertSuccessEnvelope(await json('DELETE', `/api/media/${id}/tags`, { tags: ['c'] }), 200);
      assertSuccessEnvelope(await raw('GET', '/api/media/tags'), 200);
      assertSuccessEnvelope(await json('PATCH', '/api/media/tags/rename', { from: 'a', to: 'z' }), 200);
      assertSuccessEnvelope(await raw('DELETE', '/api/media/tags/z'), 200);
      assertSuccessEnvelope(await json('POST', '/api/media/bulk-update', { ids: [id, second], description: 'd' }), 200);
      assertSuccessEnvelope(await raw('DELETE', `/api/media/${id}`), 200);
      assertSuccessEnvelope(await json('POST', '/api/media/bulk-delete', { ids: [second] }), 200);
    });

    it('returns a list as data.results with data.pagination, even when empty', async () => {
      const empty = await raw('GET', '/api/media');
      assertSuccessEnvelope(empty, 200);
      assert.deepEqual(empty.json.data, { results: [], pagination: { total: 0, page: 1, limit: 10, totalPages: 0 } });

      await t.upload();
      const list = await raw('GET', '/api/media');
      assert.deepEqual(Object.keys(list.json.data).sort(), ['pagination', 'results']);
      assert.equal(list.json.data.results.length, 1);
      assert.deepEqual(list.json.data.pagination, { total: 1, page: 1, limit: 10, totalPages: 1 });
    });

    it('never puts count, total, pagination, meta or message at the top level', async () => {
      await t.upload();
      const res = await raw('GET', '/api/media');
      for (const key of ['count', 'total', 'pagination', 'meta', 'message', 'success']) assert.equal(key in res.json, false, key);
    });

    it('does not advertise the framework', async () => {
      const res = await raw('GET', '/api/health');
      assert.equal(res.headers.get('x-powered-by'), null);
    });

    it('reports fileDeleted: false when a record was deleted but its file could not be removed', async () => {
      const media = (await t.upload()).body.data;
      require('node:fs').rmSync(media.filePath);
      const res = await raw('DELETE', `/api/media/${media.id}`);
      assertSuccessEnvelope(res, 200);
      assert.deepEqual(res.json.data, { id: media.id, fileDeleted: false });
    });
  });

  describe('errorHandler on its own', () => {
    const { errorHandler } = require('../src/middlewares/errorHandler');
    const AppError = require('../src/utils/AppError');
    const run = (err, { headersSent = false } = {}) => {
      const out = { status: null, body: null, nextCalled: false };
      const res = { headersSent, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
      errorHandler(err, { method: 'GET', originalUrl: '/x' }, res, () => { out.nextCalled = true; });
      return out;
    };

    it('uses an AppError status and message as they are', () => {
      const out = run(new AppError('custom message', 418));
      assert.equal(out.status, 418);
      assert.deepEqual(out.body, { status: 'error', message: 'custom message', details: [] });
    });

    it('passes validation details through', () => {
      const details = [{ field: 'title', message: 'Title is required' }];
      const out = run(new AppError('Validation failed', 400, details));
      assert.deepEqual(out.body, { status: 'error', message: 'Validation failed', details });
    });

    it('does not write a response that has already started, and hands the error to Express', () => {
      const out = run(new Error('late'), { headersSent: true });
      assert.equal(out.nextCalled, true);
      assert.equal(out.status, null);
      assert.equal(out.body, null);
    });
  });
});
