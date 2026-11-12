const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// A small size limit (~10 KB) so the size test stays fast
process.env.MAX_FILE_SIZE_MB = '0.01';
const LIMIT = Math.floor(0.01 * 1024 * 1024);

// Must be required before anything from src/ (sets the test database)
const { startTestApp } = require('./helpers/testApp');

describe('POST /api/media/multiple (several files in one request)', () => {
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

  // Build a form with files in the field "files": spec = [name, type, content?]
  const filesForm = (specs, fields = {}, field = 'files') => (form) => {
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    for (const [name, type, content = 'some bytes'] of specs) {
      form.append(field, new Blob([content], { type }), name);
    }
  };
  const post = async (build) => {
    const form = new FormData();
    build(form);
    const res = await fetch(`${t.base}/api/media/multiple`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
  };

  const PNG = ['photo.png', 'image/png'];
  const JPG = ['picture.jpg', 'image/jpeg'];
  const PDF = ['report.pdf', 'application/pdf'];

  // A rejected request must leave no file on disk and no database row
  const assertNothingStored = async () => {
    assert.deepEqual(t.filesOnDisk(), [], 'no file may be left in the upload folder');
    assert.equal(await t.rowCount(), 0, 'no database row may be created');
  };
  const assertRejected = async (res, pattern, status = 400) => {
    assert.equal(res.status, status, JSON.stringify(res.body));
    assert.equal(res.body.status, 'error');
    if (pattern) {
      assert.match([res.body.message, ...res.body.details.map((d) => d.message)].join(' | '), pattern);
    }
    await assertNothingStored();
  };

  describe('success', () => {
    it('stores every file and creates one record per file', async () => {
      const res = await post(filesForm([PNG, JPG, PDF], { category: 'design', tags: 'Batch, upload' }));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.deepEqual(Object.keys(res.body), ['status', 'data']);
      assert.equal(res.body.status, 'success');
      assert.deepEqual(Object.keys(res.body.data), ['results']);

      const { results } = res.body.data;
      assert.equal(results.length, 3);
      // same order as sent; the title of each is its own file name
      assert.deepEqual(results.map((m) => m.title), ['photo', 'picture', 'report']);
      assert.deepEqual(results.map((m) => m.originalName), ['photo.png', 'picture.jpg', 'report.pdf']);
      assert.deepEqual(results.map((m) => m.mediaType), ['image', 'image', 'document']);
      assert.deepEqual(results.map((m) => m.mimeType), ['image/png', 'image/jpeg', 'application/pdf']);
      // category and tags apply to all of them
      assert.ok(results.every((m) => m.category === 'design'));
      assert.ok(results.every((m) => m.tags.join() === 'batch,upload'));
      // distinct ids, distinct stored names, numeric sizes
      assert.equal(new Set(results.map((m) => m.id)).size, 3);
      assert.equal(new Set(results.map((m) => m.fileName)).size, 3);
      assert.ok(results.every((m) => typeof m.fileSize === 'number' && m.fileSize === 'some bytes'.length));
      // and they are really saved
      assert.deepEqual(t.filesOnDisk().sort(), results.map((m) => m.fileName).sort());
      assert.equal(await t.rowCount(), 3);
      const list = (await t.request('GET', '/api/media?sortBy=title&sortOrder=asc')).body.data.results;
      assert.deepEqual(list.map((m) => m.title), ['photo', 'picture', 'report']);
    });

    it('works with a single file', async () => {
      const res = await post(filesForm([PNG]));
      assert.equal(res.status, 201);
      assert.equal(res.body.data.results.length, 1);
    });

    it('defaults the category to "general" and the tags to none', async () => {
      const res = await post(filesForm([PNG, PDF]));
      assert.ok(res.body.data.results.every((m) => m.category === 'general' && m.tags.length === 0));
    });

    it('accepts a description, shared by every file', async () => {
      const res = await post(filesForm([PNG, PDF], { description: 'Quarterly batch' }));
      assert.ok(res.body.data.results.every((m) => m.description === 'Quarterly batch'));
    });

    it('accepts exactly 10 files', async () => {
      const ten = Array.from({ length: 10 }, (_, i) => [`img${i}.png`, 'image/png']);
      const res = await post(filesForm(ten));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.results.length, 10);
      assert.equal(t.filesOnDisk().length, 10);
      assert.equal(await t.rowCount(), 10);
    });

    it('stores the same file sent twice as two separate items', async () => {
      const res = await post(filesForm([PNG, PNG]));
      assert.equal(res.status, 201);
      const [a, b] = res.body.data.results;
      assert.notEqual(a.id, b.id);
      assert.notEqual(a.fileName, b.fileName);
    });

    it('keeps unicode names', async () => {
      const res = await post(filesForm([['写真 фото.png', 'image/png']]));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.results[0].originalName, '写真 фото.png');
      assert.equal(res.body.data.results[0].title, '写真 фото');
    });
  });

  describe('rejected requests store nothing at all', () => {
    it('rejects the whole batch when one file has a disallowed type', async () => {
      await assertRejected(await post(filesForm([PNG, ['clip.mp4', 'video/mp4'], PDF])), /Unsupported file type: video\/mp4/);
    });

    it('rejects a file whose name does not match its declared type', async () => {
      await assertRejected(await post(filesForm([PNG, ['virus.exe', 'image/png']])), /\.exe file is not allowed for image\/png/);
    });

    it('rejects the whole batch when one file is too large', async () => {
      const big = ['big.png', 'image/png', 'x'.repeat(LIMIT + 1)];
      await assertRejected(await post(filesForm([PNG, JPG, big])), /File is too large \(max 0\.01 MB\)/);
    });

    it('rejects the whole batch when one file is empty, naming the file', async () => {
      await assertRejected(await post(filesForm([PNG, ['empty.png', 'image/png', '']])), /"empty\.png" is empty/);
    });

    it('rejects more than 10 files', async () => {
      const eleven = Array.from({ length: 11 }, (_, i) => [`img${i}.png`, 'image/png']);
      await assertRejected(await post(filesForm(eleven)), /at most 10 files/i);
    });

    it('rejects files sent in the wrong field', async () => {
      await assertRejected(await post(filesForm([PNG], {}, 'file')), /form field named "files"/);
      await assertRejected(await post(filesForm([PNG], {}, 'photos')), /form field named "files"/);
    });

    it('rejects a request with no files', async () => {
      await assertRejected(await post(() => {}), /At least one file is required/);
      await assertRejected(await post((f) => f.append('category', 'design')), /At least one file is required/);
    });

    it('rejects invalid shared fields and reports them by field', async () => {
      const res = await post(filesForm([PNG, PDF], { category: 'nonsense', tags: 'x'.repeat(60) }));
      await assertRejected(res, /category must be one of/i);
      assert.deepEqual(res.body.details.map((d) => d.field).sort(), ['category', 'tags']);
    });

    it('does not accept per-file fields (title, width, height, duration) or unknown fields', async () => {
      const res = await post(filesForm([PNG, PDF], { title: 'One title', width: '10', colour: 'red' }));
      await assertRejected(res, /not allowed/);
      assert.deepEqual(res.body.details.map((d) => d.field).sort(), ['colour', 'title', 'width']);
    });

    it('is all-or-nothing when the database refuses one of the rows', async () => {
      // the third name is too long for the database (255 characters): the whole batch must fail
      const tooLong = [`${'a'.repeat(300)}.png`, 'image/png'];
      const res = await post(filesForm([PNG, JPG, tooLong]));
      assert.equal(res.status, 400, JSON.stringify(res.body));
      await assertNothingStored(); // not even the first two rows or files
    });

    it('removes every stored file and answers 500 if saving fails unexpectedly', async () => {
      const original = t.pool.query;
      t.pool.query = async (sql, ...rest) =>
        /INSERT INTO media_assets/.test(sql) ? Promise.reject(new TypeError('boom')) : original.call(t.pool, sql, ...rest);
      const log = console.error;
      console.error = () => {};
      let res;
      try {
        res = await post(filesForm([PNG, JPG, PDF]));
      } finally {
        t.pool.query = original;
        console.error = log;
      }
      await assertRejected(res, /Internal server error/, 500);
    });
  });

  describe('alongside the single-file upload', () => {
    it('POST /api/media still takes exactly one file in the field "file"', async () => {
      const one = await t.upload({ fields: { title: 'Single' } });
      assert.equal(one.status, 201);
      assert.equal(one.body.data.title, 'Single');
      assert.equal(Object.hasOwn(one.body.data, 'results'), false, 'a single upload returns the item itself');
    });

    it('POST /api/media rejects a second file', async () => {
      const res = await t.uploadForm((f) => {
        f.append('title', 'Two files');
        f.append('file', new Blob(['a'], { type: 'image/png' }), 'a.png');
        f.append('file', new Blob(['b'], { type: 'image/png' }), 'b.png');
      });
      await assertRejected(res, /one file at a time/);
    });
  });
});
