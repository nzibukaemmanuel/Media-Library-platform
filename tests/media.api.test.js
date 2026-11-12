const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Must be required before anything from src/ (sets the test database)
const { startTestApp } = require('./helpers/testApp');

// Every response must use the standard envelope
const assertSuccess = (res, status) => {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.equal(typeof res.body.message, 'string');
  assert.ok('data' in res.body);
};
const assertError = (res, status, messagePattern) => {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal('data' in res.body, false);
  if (messagePattern) assert.match(res.body.message, messagePattern);
};

describe('Media API endpoints', () => {
  let t; // the running test app

  before(async () => {
    t = await startTestApp();
  });
  after(async () => {
    await t.stop();
  });
  beforeEach(async () => {
    await t.reset();
  });

  // Upload helper that must succeed; returns the created record
  const createMedia = async (options) => {
    const res = await t.upload(options);
    assertSuccess(res, 201);
    return res.body.data;
  };

  describe('GET / and GET /api/health', () => {
    it('welcome route responds', async () => {
      const res = await t.request('GET', '/');
      assertSuccess(res, 200);
    });

    it('health check reports the server is running', async () => {
      const res = await t.request('GET', '/api/health');
      assertSuccess(res, 200);
      assert.match(res.body.message, /running/i);
    });

    it('unknown routes return a JSON 404', async () => {
      const res = await t.request('GET', '/api/does-not-exist');
      assertError(res, 404, /Route not found/);
    });
  });

  describe('POST /api/media (upload)', () => {
    it('stores the file and saves its metadata', async () => {
      const res = await t.upload({
        name: 'Holiday Photo.PNG',
        fields: { title: 'Holiday', description: 'Beach day', tags: 'Summer, Beach', width: '640', height: '480' },
      });
      assertSuccess(res, 201);
      assert.equal(res.body.message, 'Media uploaded successfully');

      const media = res.body.data;
      assert.equal(media.title, 'Holiday');
      assert.equal(media.description, 'Beach day');
      assert.equal(media.media_type, 'image');
      assert.equal(media.mime_type, 'image/png');
      assert.equal(media.original_name, 'Holiday Photo.PNG');
      assert.equal(media.width, 640);
      assert.equal(media.height, 480);
      assert.deepEqual(media.tags, ['summer', 'beach']);
      assert.equal(Number(media.file_size), 'fake-image-bytes'.length);
      assert.ok(media.id > 0);
      assert.ok(media.created_at);

      // the file is on disk under a generated name, inside the upload folder
      assert.notEqual(media.file_name, media.original_name);
      assert.ok(fs.existsSync(media.file_path));
      assert.deepEqual(t.filesOnDisk(), [media.file_name]);
    });

    it('uses the file name as the title when none is given', async () => {
      const media = await createMedia({ name: 'sunset.jpg', type: 'image/jpeg' });
      assert.equal(media.title, 'sunset');
    });

    it('detects the media type from the file', async () => {
      assert.equal((await createMedia({ name: 'a.mp4', type: 'video/mp4' })).media_type, 'video');
      assert.equal((await createMedia({ name: 'a.mp3', type: 'audio/mpeg' })).media_type, 'audio');
      assert.equal((await createMedia({ name: 'a.pdf', type: 'application/pdf' })).media_type, 'document');
    });

    it('rejects a request with no file', async () => {
      const res = await t.request('POST', '/api/media');
      assertError(res, 400, /file is required/);
    });

    it('rejects an unsupported file and stores nothing', async () => {
      const res = await t.upload({ name: 'tool.exe', type: 'application/x-msdownload' });
      assertError(res, 400);
      assert.deepEqual(t.filesOnDisk(), []);
    });
  });

  describe('GET /api/media/:id', () => {
    it('returns one media item', async () => {
      const created = await createMedia({ fields: { title: 'One' } });
      const res = await t.request('GET', `/api/media/${created.id}`);
      assertSuccess(res, 200);
      assert.equal(res.body.data.id, created.id);
      assert.equal(res.body.data.title, 'One');
    });

    it('returns 404 for a missing item', async () => {
      assertError(await t.request('GET', '/api/media/999999'), 404, /Media not found/);
    });

    it('returns 400 for an invalid id', async () => {
      assertError(await t.request('GET', '/api/media/abc'), 400, /id must be a number/);
    });
  });

  describe('GET /api/media (list)', () => {
    it('returns an empty list when there is no media', async () => {
      const res = await t.request('GET', '/api/media');
      assertSuccess(res, 200);
      assert.deepEqual(res.body.data, []);
      assert.equal(res.body.meta.count, 0);
      assert.equal(res.body.meta.pagination.total, 0);
    });

    it('returns media newest first with pagination info', async () => {
      await createMedia({ fields: { title: 'first' } });
      await createMedia({ fields: { title: 'second' } });
      await createMedia({ fields: { title: 'third' } });

      const res = await t.request('GET', '/api/media');
      assertSuccess(res, 200);
      assert.deepEqual(res.body.data.map((m) => m.title), ['third', 'second', 'first']);
      assert.equal(res.body.meta.count, 3);
      assert.deepEqual(res.body.meta.pagination, {
        page: 1, limit: 20, total: 3, totalPages: 1, hasNext: false, hasPrev: false,
      });
    });
  });

  describe('PATCH /api/media/:id', () => {
    it('updates the metadata and returns the item', async () => {
      const created = await createMedia({ fields: { title: 'Old' } });
      const res = await t.request('PATCH', `/api/media/${created.id}`, {
        title: 'New', description: 'Updated', tags: ['a', 'b'],
      });
      assertSuccess(res, 200);
      assert.equal(res.body.data.title, 'New');
      assert.equal(res.body.data.description, 'Updated');
      assert.deepEqual(res.body.data.tags, ['a', 'b']);

      // and it is really saved
      const fetched = await t.request('GET', `/api/media/${created.id}`);
      assert.equal(fetched.body.data.title, 'New');
    });

    it('does not let the stored file details be changed', async () => {
      const created = await createMedia();
      const res = await t.request('PATCH', `/api/media/${created.id}`, { file_path: '/etc/passwd' });
      assertError(res, 400, /file_path is not allowed/);
      assert.equal((await t.request('GET', `/api/media/${created.id}`)).body.data.file_path, created.file_path);
    });

    it('rejects an empty update', async () => {
      const created = await createMedia();
      assertError(await t.request('PATCH', `/api/media/${created.id}`, {}), 400, /at least one field/);
    });

    it('returns 404 for a missing item', async () => {
      assertError(await t.request('PATCH', '/api/media/999999', { title: 'x' }), 404);
    });
  });

  describe('DELETE /api/media/:id', () => {
    it('deletes the record and its file', async () => {
      const created = await createMedia();
      assert.equal(t.filesOnDisk().length, 1);

      const res = await t.request('DELETE', `/api/media/${created.id}`);
      assertSuccess(res, 200);
      assert.deepEqual(res.body.data, { id: created.id, fileDeleted: true });

      assertError(await t.request('GET', `/api/media/${created.id}`), 404);
      assert.deepEqual(t.filesOnDisk(), []);
    });

    it('still deletes the record if its file is already gone', async () => {
      const created = await createMedia();
      fs.rmSync(created.file_path);

      const res = await t.request('DELETE', `/api/media/${created.id}`);
      assertSuccess(res, 200);
      assert.equal(res.body.data.fileDeleted, false);
      assertError(await t.request('GET', `/api/media/${created.id}`), 404);
    });

    it('returns 404 for a missing item', async () => {
      assertError(await t.request('DELETE', '/api/media/999999'), 404);
    });
  });

  describe('tag endpoints', () => {
    it('adds tags to an item without losing existing ones', async () => {
      const created = await createMedia({ fields: { tags: 'one' } });
      const res = await t.request('POST', `/api/media/${created.id}/tags`, { tags: ['two', 'one'] });
      assertSuccess(res, 200);
      assert.deepEqual(res.body.data.tags, ['one', 'two']);
    });

    it('removes tags from an item', async () => {
      const created = await createMedia({ fields: { tags: 'one,two,three' } });
      const res = await t.request('DELETE', `/api/media/${created.id}/tags`, { tags: ['two'] });
      assertSuccess(res, 200);
      assert.deepEqual(res.body.data.tags, ['one', 'three']);
    });

    it('requires tags in the body', async () => {
      const created = await createMedia();
      assertError(await t.request('POST', `/api/media/${created.id}/tags`, {}), 400, /tags/);
    });

    it('lists every tag with how many items use it', async () => {
      await createMedia({ fields: { tags: 'shared,only-a' } });
      await createMedia({ fields: { tags: 'shared' } });

      const res = await t.request('GET', '/api/media/tags');
      assertSuccess(res, 200);
      assert.deepEqual(res.body.data, [
        { tag: 'shared', count: 2 },
        { tag: 'only-a', count: 1 },
      ]);
      assert.equal(res.body.meta.count, 2);
    });

    it('renames a tag across all items', async () => {
      const a = await createMedia({ fields: { tags: 'old,keep' } });
      const b = await createMedia({ fields: { tags: 'old' } });

      const res = await t.request('PATCH', '/api/media/tags/rename', { from: 'old', to: 'new' });
      assertSuccess(res, 200);
      assert.equal(res.body.data.changed, 2);
      assert.deepEqual((await t.request('GET', `/api/media/${a.id}`)).body.data.tags, ['new', 'keep']);
      assert.deepEqual((await t.request('GET', `/api/media/${b.id}`)).body.data.tags, ['new']);
    });

    it('deletes a tag from all items', async () => {
      const a = await createMedia({ fields: { tags: 'gone,stay' } });
      const res = await t.request('DELETE', '/api/media/tags/gone');
      assertSuccess(res, 200);
      assert.equal(res.body.data.changed, 1);
      assert.deepEqual((await t.request('GET', `/api/media/${a.id}`)).body.data.tags, ['stay']);
      assertError(await t.request('DELETE', '/api/media/tags/gone'), 404, /not found/);
    });
  });

  describe('bulk endpoints', () => {
    it('updates several items at once and reports missing ids', async () => {
      const a = await createMedia();
      const b = await createMedia();
      const res = await t.request('POST', '/api/media/bulk-update', {
        ids: [a.id, b.id, 999999], description: 'bulk edit',
      });
      assertSuccess(res, 200);
      assert.equal(res.body.data.updated.length, 2);
      assert.deepEqual(res.body.data.notFound, [999999]);
      assert.equal((await t.request('GET', `/api/media/${a.id}`)).body.data.description, 'bulk edit');
    });

    it('requires at least one field to bulk update', async () => {
      const a = await createMedia();
      assertError(await t.request('POST', '/api/media/bulk-update', { ids: [a.id] }), 400, /at least one field/);
    });

    it('deletes several items and their files at once', async () => {
      const a = await createMedia();
      const b = await createMedia();
      assert.equal(t.filesOnDisk().length, 2);

      const res = await t.request('POST', '/api/media/bulk-delete', { ids: [a.id, b.id, 999999] });
      assertSuccess(res, 200);
      assert.deepEqual(res.body.data.deleted.sort(), [a.id, b.id].sort());
      assert.deepEqual(res.body.data.notFound, [999999]);
      assert.deepEqual(res.body.data.filesNotDeleted, []);
      assert.deepEqual(t.filesOnDisk(), []);
    });

    it('requires a non-empty list of ids', async () => {
      assertError(await t.request('POST', '/api/media/bulk-delete', { ids: [] }), 400, /ids/);
    });
  });
});
