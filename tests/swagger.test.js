const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Must be required before anything from src/ (sets the test database)
const { startTestApp } = require('./helpers/testApp');

const SwaggerParser = require('@apidevtools/swagger-parser');
const spec = require('../src/docs/openapi');
const router = require('../src/routes/mediaRoutes');
const schemas = require('../src/validations/mediaValidation');
const constants = require('../src/config/constants');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// Every operation in the document as "METHOD /path"
const documentedOperations = () =>
  Object.entries(spec.paths).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((m) => `${m.toUpperCase()} ${path}`)
  );

// Every route in the router as "METHOD /media/path" (Express :id -> OpenAPI {id})
const implementedOperations = () =>
  router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods).map(
        (m) => `${m.toUpperCase()} /media${layer.route.path === '/' ? '' : layer.route.path.replaceAll(/:(\w+)/g, '{$1}')}`
      )
    );

// The keys a Joi object schema accepts
const joiKeys = (schema) => Object.keys(schema.describe().keys).sort();

describe('Swagger UI and the OpenAPI document', () => {
  let t;
  before(async () => {
    t = await startTestApp();
  });
  after(async () => {
    await t.stop();
  });
  beforeEach(async () => {
    await t.reset();
  });

  describe('served by the app', () => {
    it('shows the Swagger UI page at /api-docs', async () => {
      const res = await fetch(`${t.base}/api-docs/`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      const html = await res.text();
      assert.match(html, /swagger-ui/);
      assert.match(html, /<title>Media Library API<\/title>/);
    });

    it('redirects /api-docs to /api-docs/', async () => {
      const res = await fetch(`${t.base}/api-docs`, { redirect: 'manual' });
      assert.equal(res.status, 301);
      assert.equal(res.headers.get('location'), '/api-docs/');
    });

    it('serves the raw OpenAPI document at /api-docs.json', async () => {
      const res = await fetch(`${t.base}/api-docs.json`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /application\/json/);
      const body = await res.json();
      assert.equal(body.openapi, '3.0.3');
      assert.equal(body.info.title, 'Media Library API');
      assert.deepEqual(body.paths, JSON.parse(JSON.stringify(spec.paths)));
    });

    it('serves the document as standard OpenAPI JSON, not in the API response format', async () => {
      const body = await (await fetch(`${t.base}/api-docs.json`)).json();
      assert.equal('status' in body, false);
      assert.equal('data' in body, false);
    });

    it('is mentioned by the welcome route', async () => {
      const res = await (await fetch(`${t.base}/`)).json();
      assert.equal(res.data.docs, '/api-docs');
    });

    it('leaves the rest of the app alone: unknown routes are still a JSON 404', async () => {
      const res = await fetch(`${t.base}/api-docs-nope`);
      assert.equal(res.status, 404);
      assert.equal((await res.json()).status, 'error');
      assert.equal((await fetch(`${t.base}/api/health`)).status, 200);
    });
  });

  describe('the document is valid OpenAPI', () => {
    it('passes the OpenAPI validator, with every $ref resolving', async () => {
      // validate() works on a copy and throws a descriptive error if anything is wrong
      const api = await SwaggerParser.validate(JSON.parse(JSON.stringify(spec)));
      assert.equal(api.info.version, '1.0.0');
    });

    it('describes every operation with a summary, a tag and a success response', () => {
      for (const [path, item] of Object.entries(spec.paths)) {
        for (const method of METHODS.filter((m) => item[m])) {
          const op = item[method];
          const name = `${method.toUpperCase()} ${path}`;
          assert.ok(op.summary, `${name} has no summary`);
          assert.ok(op.tags?.length, `${name} has no tag`);
          assert.ok(Object.keys(op.responses).some((code) => /^2/.test(code)), `${name} documents no success response`);
        }
      }
    });

    it('documents the standard error responses where they can happen', () => {
      const ops = (path, method) => spec.paths[path][method].responses;
      assert.ok(ops('/media', 'post')[400] && ops('/media', 'get')[400]);
      assert.ok(ops('/media/{id}', 'get')[404] && ops('/media/{id}', 'delete')[404]);
      assert.ok(ops('/media/{id}', 'put')[404]);
      for (const code of ['BadRequest', 'NotFound', 'ServerError', 'ServiceUnavailable']) {
        assert.ok(spec.components.responses[code], `${code} response is missing`);
      }
    });

    it('describes the success and error response formats', () => {
      const created = spec.paths['/media'].post.responses[201].content['application/json'].schema;
      assert.deepEqual(created.required, ['status', 'data']);
      assert.deepEqual(created.properties.status.enum, ['success']);
      assert.deepEqual(spec.components.schemas.Error.required, ['status', 'message', 'details']);
      assert.deepEqual(spec.components.schemas.Error.properties.status.enum, ['error']);
      const list = spec.paths['/media'].get.responses[200].content['application/json'].schema.properties.data;
      assert.deepEqual(Object.keys(list.properties), ['results', 'pagination']);
      assert.deepEqual(Object.keys(spec.components.schemas.Pagination.properties), ['total', 'page', 'limit', 'totalPages']);
    });
  });

  describe('the document matches the real API', () => {
    it('describes every route of the router, and nothing that does not exist', () => {
      const real = implementedOperations().sort();
      const documented = documentedOperations()
        .filter((op) => !op.endsWith('/api/health')) // not part of the media router
        .sort();
      assert.deepEqual(documented, real);
      assert.equal(real.length, 14);
    });

    it('also documents the health check', () => {
      assert.ok(spec.paths['/api/health'].get);
    });

    it('lists exactly the query parameters that GET /media accepts', () => {
      const documented = spec.paths['/media'].get.parameters.map((p) => p.name).sort();
      assert.deepEqual(documented, joiKeys(schemas.listMediaQuery));
    });

    it('lists exactly the fields that upload accepts', () => {
      const upload = spec.paths['/media'].post.requestBody.content['multipart/form-data'].schema;
      assert.deepEqual(Object.keys(upload.properties).sort(), ['file', ...joiKeys(schemas.createMediaBody)].sort());
      assert.deepEqual(upload.required.sort(), ['file', 'title']);
      const multiple = spec.paths['/media/multiple'].post.requestBody.content['multipart/form-data'].schema;
      assert.deepEqual(Object.keys(multiple.properties).sort(), ['files', ...joiKeys(schemas.createMultipleBody)].sort());
    });

    it('lists exactly the fields that update, bulk update and the tag endpoints accept', () => {
      assert.deepEqual(Object.keys(spec.components.schemas.UpdateMedia.properties).sort(), joiKeys(schemas.updateMediaBody));
      const bulk = spec.paths['/media/bulk-update'].post.requestBody.content['application/json'].schema;
      assert.deepEqual(Object.keys(bulk.properties).sort(), joiKeys(schemas.bulkUpdateBody));
      const rename = spec.paths['/media/tags/rename'].patch.requestBody.content['application/json'].schema;
      assert.deepEqual(Object.keys(rename.properties).sort(), joiKeys(schemas.renameTagBody));
      const tagsBody = spec.paths['/media/{id}/tags'].post.requestBody.content['application/json'].schema;
      assert.deepEqual(Object.keys(tagsBody.properties).sort(), joiKeys(schemas.tagsBody));
      const del = spec.paths['/media/bulk-delete'].post.requestBody.content['application/json'].schema;
      assert.deepEqual(Object.keys(del.properties).sort(), joiKeys(schemas.bulkDeleteBody));
    });

    it('uses the same enums and limits as the validation', () => {
      assert.deepEqual(spec.components.schemas.Category.enum, constants.CATEGORIES);
      const params = Object.fromEntries(spec.paths['/media'].get.parameters.map((p) => [p.name, p.schema]));
      assert.deepEqual(params.sortBy.enum, constants.SORT_FIELDS);
      assert.deepEqual(params.order.enum, constants.SORT_ORDERS);
      assert.equal(params.limit.default, 10);
      assert.equal(params.limit.maximum, 50);
      assert.equal(params.page.default, 1);
      assert.deepEqual(params.mimeType.enum, ['image/jpeg', 'image/png', 'application/pdf']);
      const multiple = spec.paths['/media/multiple'].post.requestBody.content['multipart/form-data'].schema;
      assert.equal(multiple.properties.files.maxItems, 10);
    });

    it('describes the media object with exactly the fields the API returns', async () => {
      const created = await t.upload({ fields: { title: 'Doc check', tags: 'a' } });
      assert.equal(created.status, 201);
      const documented = Object.keys(spec.components.schemas.Media.properties);
      assert.deepEqual(documented, Object.keys(created.body.data), 'same fields, in the same order');
      assert.deepEqual([...spec.components.schemas.Media.required].sort(), [...documented].sort());
    });

    it('documents the right JSON types for the media fields', async () => {
      const media = (await t.upload({ fields: { title: 'Types', duration: '1.5', width: '3', height: '4' } })).body.data;
      const props = spec.components.schemas.Media.properties;
      const jsType = (v) => (Number.isInteger(v) ? 'integer' : typeof v === 'number' ? 'number' : Array.isArray(v) ? 'array' : typeof v);
      for (const [field, schema] of Object.entries(props)) {
        if (schema.$ref) continue; // category: an enum reference
        const value = media[field];
        const type = value === null ? null : jsType(value);
        if (type === null) assert.equal(schema.nullable, true, `${field} can be null, so the document must say nullable`);
        else if (schema.type === 'number') assert.ok(['integer', 'number'].includes(type), `${field}: ${type}`);
        else assert.equal(type, schema.type, `${field}: the API returned ${type}`);
      }
    });

    it('documents the error format the API really produces', async () => {
      const res = await t.request('POST', '/api/media');
      assert.deepEqual(Object.keys(res.body).sort(), Object.keys(spec.components.schemas.Error.properties).sort());
    });
  });
});
