const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Must be required before anything from src/ (sets the test database)
const { startTestApp } = require('./helpers/testApp');

// Every response must use the standard format:
//   success: { status: "success", data }
//   error:   { status: "error", message, details: [{ field, message }] }
const assertSuccess = (res, status) => {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body).sort(), ['data', 'status']);
  assert.equal(res.body.status, 'success');
};
// messagePattern is matched against the message and the field-level details,
// because validation errors say "Validation failed" and list the problems in details
const assertError = (res, status, messagePattern) => {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body).sort(), ['details', 'message', 'status']);
  assert.equal(res.body.status, 'error');
  assert.ok(Array.isArray(res.body.details));
  for (const d of res.body.details) assert.deepEqual(Object.keys(d).sort(), ['field', 'message']);
  if (messagePattern) {
    // details are capitalised sentences ("Title is required"), so match without regard to case
    const text = [res.body.message, ...res.body.details.map((d) => d.message)].join(' | ');
    assert.match(text, new RegExp(messagePattern.source, messagePattern.flags.includes('i') ? messagePattern.flags : `${messagePattern.flags}i`));
  }
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
      assert.match(res.body.data.message, /running/i);
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

      const media = res.body.data;
      assert.equal(media.title, 'Holiday');
      assert.equal(media.description, 'Beach day');
      assert.equal(media.mediaType, 'image');
      assert.equal(media.mimeType, 'image/png');
      assert.equal(media.originalName, 'Holiday Photo.PNG');
      assert.equal(media.width, 640);
      assert.equal(media.height, 480);
      assert.deepEqual(media.tags, ['summer', 'beach']);
      assert.equal(Number(media.fileSize), 'fake-image-bytes'.length);
      assert.ok(media.id > 0);
      assert.ok(media.createdAt);

      // the file is on disk under a generated name, inside the upload folder
      assert.notEqual(media.fileName, media.originalName);
      assert.ok(fs.existsSync(media.filePath));
      assert.deepEqual(t.filesOnDisk(), [media.fileName]);
    });

    it('requires a title', async () => {
      const res = await t.uploadForm((f) => f.append('file', new Blob(['bytes'], { type: 'image/png' }), 'sunset.png'));
      assertError(res, 400, /title is required/);
      assert.ok(res.body.details.some((d) => d.field === 'title'));
      assert.deepEqual(t.filesOnDisk(), [], 'the rejected upload must not be stored');
      assert.equal(await t.rowCount(), 0);
    });

    it('detects the media type from the file', async () => {
      assert.equal((await createMedia({ name: 'a.jpg', type: 'image/jpeg' })).mediaType, 'image');
      assert.equal((await createMedia({ name: 'a.png', type: 'image/png' })).mediaType, 'image');
      assert.equal((await createMedia({ name: 'a.pdf', type: 'application/pdf' })).mediaType, 'document');
    });

    it('accepts only JPEG, PNG and PDF files', async () => {
      const res = await t.upload({ name: 'clip.mp4', type: 'video/mp4' });
      assertError(res, 400, /Unsupported file type: video\/mp4. Allowed types: image\/jpeg, image\/png, application\/pdf/);
      assert.deepEqual(t.filesOnDisk(), []);
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

  describe('the media object (Media model)', () => {
    it('uses camelCase field names and nothing else', async () => {
      const media = await createMedia({ fields: { description: 'd', tags: 'a' } });
      assert.deepEqual(Object.keys(media).sort(), [
        'category', 'createdAt', 'description', 'duration', 'fileName', 'filePath', 'fileSize', 'height',
        'id', 'mediaType', 'mimeType', 'originalName', 'tags', 'title', 'updatedAt', 'width',
      ]);
      for (const key of Object.keys(media)) assert.doesNotMatch(key, /_/, `"${key}" must not be snake_case`);
    });

    it('lists the fields in a fixed, readable order', async () => {
      const media = await createMedia();
      assert.deepEqual(Object.keys(media), [
        'id', 'title', 'description', 'category', 'mediaType', 'fileName', 'originalName', 'filePath',
        'mimeType', 'fileSize', 'width', 'height', 'duration', 'tags', 'createdAt', 'updatedAt',
      ]);
    });

    it('returns fileSize and duration as numbers, not strings', async () => {
      const media = await createMedia({ content: 'twelve bytes', fields: { duration: '12.345', width: '640' } });
      assert.equal(typeof media.fileSize, 'number');
      assert.equal(media.fileSize, 'twelve bytes'.length);
      assert.equal(typeof media.duration, 'number');
      assert.equal(media.duration, 12.35);
      assert.equal(media.width, 640);

      const none = await createMedia();
      assert.equal(none.duration, null, 'a missing duration stays null, not 0');
      // and the same on every endpoint that returns a media object
      const fetched = (await t.request('GET', `/api/media/${media.id}`)).body.data;
      assert.equal(fetched.fileSize, media.fileSize);
      assert.equal(fetched.duration, 12.35);
      const listed = (await t.request('GET', '/api/media')).body.data.results;
      assert.ok(listed.every((m) => typeof m.fileSize === 'number'));
    });
  });

  describe('category', () => {
    it('defaults to "general"', async () => {
      assert.equal((await createMedia()).category, 'general');
    });

    it('is stored and returned, ignoring case', async () => {
      const media = await createMedia({ fields: { category: 'Marketing' } });
      assert.equal(media.category, 'marketing');
      assert.equal((await t.request('GET', `/api/media/${media.id}`)).body.data.category, 'marketing');
    });

    it('accepts every valid category', async () => {
      for (const category of ['general', 'marketing', 'design', 'documentation', 'reports', 'other']) {
        assert.equal((await createMedia({ fields: { category } })).category, category);
      }
    });

    it('rejects an unknown category on upload and stores nothing', async () => {
      const res = await t.upload({ fields: { category: 'cat-pictures' } });
      assertError(res, 400, /category must be one of: general, marketing, design, documentation, reports, other/);
      assert.ok(res.body.details.some((d) => d.field === 'category'));
      assert.deepEqual(t.filesOnDisk(), []);
      assert.equal(await t.rowCount(), 0);
    });

    it('can be changed with an update', async () => {
      const media = await createMedia();
      const res = await t.request('PATCH', `/api/media/${media.id}`, { category: 'design' });
      assertSuccess(res, 200);
      assert.equal(res.body.data.category, 'design');
    });

    it('can be changed for several items at once', async () => {
      const a = await createMedia();
      const b = await createMedia();
      const res = await t.request('POST', '/api/media/bulk-update', { ids: [a.id, b.id], category: 'reports' });
      assertSuccess(res, 200);
      assert.deepEqual(res.body.data.updated.map((m) => m.category), ['reports', 'reports']);
    });

    it('rejects an unknown category on update', async () => {
      const media = await createMedia();
      const res = await t.request('PATCH', `/api/media/${media.id}`, { category: 'nope' });
      assertError(res, 400, /category must be one of/);
      assert.equal((await t.request('GET', `/api/media/${media.id}`)).body.data.category, 'general');
    });

    it('can be used to filter the list', async () => {
      await createMedia({ fields: { category: 'design', title: 'A design' } });
      await createMedia({ fields: { category: 'reports', title: 'A report' } });
      const res = await t.request('GET', '/api/media?category=design');
      assertSuccess(res, 200);
      assert.deepEqual(res.body.data.results.map((m) => m.title), ['A design']);
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
      assert.deepEqual(res.body.data.results, []);
      assert.deepEqual(res.body.data.pagination, { total: 0, page: 1, limit: 10, totalPages: 0 });
    });

    it('returns media newest first with pagination info', async () => {
      await createMedia({ fields: { title: 'first' } });
      await createMedia({ fields: { title: 'second' } });
      await createMedia({ fields: { title: 'third' } });

      const res = await t.request('GET', '/api/media');
      assertSuccess(res, 200);
      assert.deepEqual(Object.keys(res.body.data).sort(), ['pagination', 'results']);
      assert.deepEqual(res.body.data.results.map((m) => m.title), ['third', 'second', 'first']);
      assert.deepEqual(res.body.data.pagination, { total: 3, page: 1, limit: 10, totalPages: 1 });
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
      const res = await t.request('PATCH', `/api/media/${created.id}`, { filePath: '/etc/passwd' });
      assertError(res, 400, /filePath is not allowed/);
      assert.equal((await t.request('GET', `/api/media/${created.id}`)).body.data.filePath, created.filePath);
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
      fs.rmSync(created.filePath);

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

  describe('paths and methods from the brief', () => {
    const png = () => new Blob(['bytes'], { type: 'image/png' });
    const uploadTo = (path, fields = { title: 'Via /media' }) =>
      t.uploadForm((f) => {
        for (const [k, v] of Object.entries(fields)) f.append(k, v);
        f.append('file', png(), 'a.png');
      }, path);

    it('serves every endpoint at /media as well as /api/media', async () => {
      // upload, read, list, update, tags, bulk, delete: all through /media
      const created = await uploadTo('/media');
      assertSuccess(created, 201);
      const id = created.body.data.id;
      assertSuccess(await t.request('GET', `/media/${id}`), 200);
      assertSuccess(await t.request('GET', '/media'), 200);
      assertSuccess(await t.request('PUT', `/media/${id}`, { title: 'Renamed' }), 200);
      assertSuccess(await t.request('PATCH', `/media/${id}`, { category: 'design' }), 200);
      assertSuccess(await t.request('POST', `/media/${id}/tags`, { tags: ['x'] }), 200);
      assertSuccess(await t.request('GET', '/media/tags'), 200);
      assertSuccess(await t.request('POST', '/media/bulk-update', { ids: [id], description: 'd' }), 200);

      const many = await t.uploadForm((f) => {
        f.append('files', png(), 'one.png');
        f.append('files', png(), 'two.png');
      }, '/media/multiple');
      assertSuccess(many, 201);
      assert.equal(many.body.data.results.length, 2);

      assertSuccess(await t.request('DELETE', `/media/${id}`), 200);
      assertSuccess(await t.request('POST', '/media/bulk-delete', { ids: many.body.data.results.map((m) => m.id) }), 200);
    });

    it('shows the same data under both prefixes', async () => {
      const created = await uploadTo('/media');
      const a = await t.request('GET', `/media/${created.body.data.id}`);
      const b = await t.request('GET', `/api/media/${created.body.data.id}`);
      assert.deepEqual(a.body, b.body);
      assert.deepEqual((await t.request('GET', '/media')).body, (await t.request('GET', '/api/media')).body);
    });

    it('keeps the health check at /api/health', async () => {
      assertSuccess(await t.request('GET', '/api/health'), 200);
    });

    describe('PUT /media/:id', () => {
      it('updates the metadata and returns the item, like PATCH', async () => {
        const media = (await uploadTo('/media')).body.data;
        const res = await t.request('PUT', `/media/${media.id}`, { title: 'Updated by PUT', category: 'reports', tags: ['a', 'b'] });
        assertSuccess(res, 200);
        assert.equal(res.body.data.title, 'Updated by PUT');
        assert.equal(res.body.data.category, 'reports');
        assert.deepEqual(res.body.data.tags, ['a', 'b']);
        assert.equal(res.body.data.filePath, media.filePath, 'the stored file is untouched');
        assert.equal((await t.request('GET', `/media/${media.id}`)).body.data.title, 'Updated by PUT');
      });

      it('changes only the fields that are sent', async () => {
        const media = (await uploadTo('/media', { title: 'Keep me', description: 'Keep this too' })).body.data;
        const res = await t.request('PUT', `/media/${media.id}`, { category: 'design' });
        assert.equal(res.body.data.title, 'Keep me');
        assert.equal(res.body.data.description, 'Keep this too');
        assert.equal(res.body.data.category, 'design');
      });

      it('validates like PATCH', async () => {
        const media = (await uploadTo('/media')).body.data;
        assertError(await t.request('PUT', `/media/${media.id}`, {}), 400, /at least one field/);
        assertError(await t.request('PUT', `/media/${media.id}`, { title: '' }), 400, /title/);
        assertError(await t.request('PUT', `/media/${media.id}`, { category: 'nope' }), 400, /category must be one of/);
        assertError(await t.request('PUT', `/media/${media.id}`, { filePath: '/etc/passwd' }), 400, /filePath is not allowed/);
        assertError(await t.request('PUT', '/media/abc', { title: 'x' }), 400, /id must be a number/);
      });

      it('answers 404 for a missing item', async () => {
        assertError(await t.request('PUT', '/media/999999', { title: 'x' }), 404, /Media not found/);
      });
    });

    describe('the "order" query parameter', () => {
      beforeEach(async () => {
        for (const title of ['banana', 'apple', 'cherry']) await createMedia({ fields: { title } });
      });

      it('sorts ascending and descending', async () => {
        const asc = await t.request('GET', '/media?sortBy=title&order=asc');
        assert.deepEqual(asc.body.data.results.map((m) => m.title), ['apple', 'banana', 'cherry']);
        const desc = await t.request('GET', '/media?sortBy=title&order=desc');
        assert.deepEqual(desc.body.data.results.map((m) => m.title), ['cherry', 'banana', 'apple']);
      });

      it('is case-insensitive and defaults to newest first', async () => {
        const upper = await t.request('GET', '/media?sortBy=title&order=ASC');
        assert.deepEqual(upper.body.data.results.map((m) => m.title), ['apple', 'banana', 'cherry']);
        const none = await t.request('GET', '/media');
        assert.deepEqual(none.body.data.results.map((m) => m.title), ['cherry', 'apple', 'banana']);
      });

      it('rejects an invalid value', async () => {
        const res = await t.request('GET', '/media?order=sideways');
        assertError(res, 400, /order must be one of/);
        assert.ok(res.body.details.some((d) => d.field === 'order'));
      });

      it('no longer accepts the old name sortOrder', async () => {
        const res = await t.request('GET', '/media?sortOrder=asc');
        assertError(res, 400, /sortOrder is not allowed/);
      });
    });

    it('accepts the brief\'s example query: page, limit, category, tags, search, sortBy and order', async () => {
      await createMedia({ fields: { title: 'Sunset beach', category: 'design', tags: 'nature' } });
      await createMedia({ fields: { title: 'Sunset city', category: 'design', tags: 'urban' } });
      await createMedia({ fields: { title: 'Annual report', category: 'reports', tags: 'nature' } });
      const res = await t.request('GET', '/media?page=1&limit=10&category=design&tags=nature&search=sunset&sortBy=title&order=asc');
      assertSuccess(res, 200);
      assert.deepEqual(res.body.data.results.map((m) => m.title), ['Sunset beach']);
      assert.deepEqual(res.body.data.pagination, { total: 1, page: 1, limit: 10, totalPages: 1 });
    });

    it('defaults to 10 results per page and allows at most 50', async () => {
      for (let i = 0; i < 12; i++) await t.seed([{ title: `Row ${i}` }]);
      const byDefault = (await t.request('GET', '/media')).body.data;
      assert.equal(byDefault.results.length, 10);
      assert.deepEqual(byDefault.pagination, { total: 12, page: 1, limit: 10, totalPages: 2 });
      assert.equal((await t.request('GET', '/media?limit=50')).body.data.results.length, 12);
      assertError(await t.request('GET', '/media?limit=51'), 400, /limit must be less than or equal to 50/);
    });
  });
});
