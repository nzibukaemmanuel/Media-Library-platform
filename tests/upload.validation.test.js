const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// A tiny size limit (~10 KB) so the size tests stay fast. The upload
// middleware reads this per request, so setting it here is enough.
process.env.MAX_FILE_SIZE_MB = '0.01';
const LIMIT = Math.floor(0.01 * 1024 * 1024); // 10485 bytes

// Must be required before anything from src/ (sets the test database)
const { startTestApp } = require('./helpers/testApp');

describe('Upload validation edge cases', () => {
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

  // A rejected upload must leave no file on disk and no row in the database
  const assertNothingStored = async () => {
    assert.deepEqual(t.filesOnDisk(), [], 'no file may be left in the upload folder');
    assert.equal(await t.rowCount(), 0, 'no database row may be created');
  };
  const assertRejected = async (res, pattern) => {
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.status, 'error');
    // the message, or the field-level details of a validation error
    if (pattern) assert.match([res.body.message, ...res.body.details.map((d) => d.message)].join(' | '), pattern);
    await assertNothingStored();
  };

  describe('file type and extension', () => {
    const accepted = [
      ['photo.png', 'image/png', 'image'],
      ['photo.jpg', 'image/jpeg', 'image'],
      ['photo.jpeg', 'image/jpeg', 'image'],
      ['anim.gif', 'image/gif', 'image'],
      ['pic.webp', 'image/webp', 'image'],
      ['clip.mp4', 'video/mp4', 'video'],
      ['clip.webm', 'video/webm', 'video'],
      ['clip.mov', 'video/quicktime', 'video'],
      ['song.mp3', 'audio/mpeg', 'audio'],
      ['song.wav', 'audio/wav', 'audio'],
      ['song.flac', 'audio/flac', 'audio'],
      ['report.pdf', 'application/pdf', 'document'],
      ['letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'],
      ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'document'],
      ['notes.txt', 'text/plain', 'document'],
      ['data.csv', 'text/csv', 'document'],
    ];
    for (const [name, type, expected] of accepted) {
      it(`accepts ${name} as ${expected}`, async () => {
        const res = await t.upload({ name, type });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.equal(res.body.data.mediaType, expected);
      });
    }

    it('treats the extension case-insensitively and stores it in lower case', async () => {
      const res = await t.upload({ name: 'HOLIDAY.JpG', type: 'image/jpeg' });
      assert.equal(res.status, 201);
      assert.match(res.body.data.fileName, /\.jpg$/);
      assert.equal(res.body.data.originalName, 'HOLIDAY.JpG');
    });

    it('only the last extension counts: photo.exe.png is a png, photo.png.exe is not', async () => {
      assert.equal((await t.upload({ name: 'photo.exe.png', type: 'image/png' })).status, 201);
      await t.reset();
      await assertRejected(await t.upload({ name: 'photo.png.exe', type: 'image/png' }), /\.exe/);
    });

    const rejected = [
      ['an executable pretending to be an image', 'virus.exe', 'image/png', /\.exe file is not allowed as image/],
      ['an image whose type says video', 'movie.png', 'video/mp4', /\.png file is not allowed as video/],
      ['an HTML page (would run scripts if served back)', 'page.html', 'text/html', /\.html file is not allowed/],
      ['a JavaScript file sent as text', 'script.js', 'text/javascript', /\.js file is not allowed/],
      ['an SVG (can carry scripts)', 'logo.svg', 'image/svg+xml', /\.svg file is not allowed/],
      ['a zip archive', 'bundle.zip', 'application/zip', /Unsupported file type: application\/zip/],
      ['an unknown binary type', 'data.bin', 'application/octet-stream', /Unsupported file type/],
      ['a file with no extension', 'README', 'text/plain', /must have an extension/],
      ['a dotfile with no real extension', '.png', 'image/png', /must have an extension/],
      ['a name ending in a dot', 'photo.', 'image/png', /must have an extension/],
    ];
    for (const [label, name, type, pattern] of rejected) {
      it(`rejects ${label}`, async () => {
        await assertRejected(await t.upload({ name, type }), pattern);
      });
    }
  });

  describe('file size', () => {
    it('accepts a file exactly at the limit', async () => {
      const res = await t.upload({ content: 'x'.repeat(LIMIT) });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(Number(res.body.data.fileSize), LIMIT);
    });

    it('rejects a file one byte over the limit and stores nothing', async () => {
      await assertRejected(await t.upload({ content: 'x'.repeat(LIMIT + 1) }), /File is too large/);
    });

    it('rejects a much larger file the same way', async () => {
      await assertRejected(await t.upload({ content: 'x'.repeat(LIMIT * 20) }), /File is too large/);
    });

    it('rejects an empty file', async () => {
      await assertRejected(await t.upload({ content: '' }), /empty/i);
    });

    it('accepts a one-byte file', async () => {
      assert.equal((await t.upload({ content: 'x' })).status, 201);
    });
  });

  describe('file names', () => {
    it('never lets a path in the file name escape the upload folder', async () => {
      for (const name of ['../../evil.png', '..\\..\\evil.png', '/etc/evil.png', 'C:\\Windows\\evil.png']) {
        const res = await t.upload({ name, type: 'image/png' });
        assert.equal(res.status, 201, `${name}: ${JSON.stringify(res.body)}`);
        const stored = res.body.data;
        assert.equal(path.dirname(stored.filePath), t.uploadDir, `${name} must be stored inside the upload folder`);
        assert.equal(path.basename(stored.fileName), stored.fileName, 'stored name has no directory part');
        assert.match(stored.fileName, /^\d+-[0-9a-f-]{36}\.png$/, 'stored under a generated name');
      }
      assert.equal(t.filesOnDisk().length, 4);
    });

    it('keeps spaces and unicode characters in the original name', async () => {
      const name = 'Zażółć gęślą jaźń 写真 фото.png';
      const res = await t.upload({ name, type: 'image/png', fields: { title: 'Zażółć 写真 фото' } });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.originalName, name);
      assert.equal(res.body.data.title, 'Zażółć 写真 фото'); // form fields keep unicode too
    });

    it('rejects a name too long for the database without leaving a file behind', async () => {
      const res = await t.upload({ name: `${'a'.repeat(300)}.png`, type: 'image/png' });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      await assertNothingStored();
    });

    it('accepts a name at the 255 character limit', async () => {
      const name = `${'a'.repeat(251)}.png`;
      const res = await t.upload({ name, type: 'image/png' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.originalName, name);
    });

    it('stores the same file uploaded twice as two separate files', async () => {
      const a = (await t.upload({ name: 'same.png' })).body.data;
      const b = (await t.upload({ name: 'same.png' })).body.data;
      assert.notEqual(a.id, b.id);
      assert.notEqual(a.fileName, b.fileName);
      assert.equal(t.filesOnDisk().length, 2);
    });

    it('gives every file in a burst of parallel uploads its own name', async () => {
      const results = await Promise.all(Array.from({ length: 12 }, () => t.upload({ name: 'burst.png' })));
      assert.ok(results.every((r) => r.status === 201));
      assert.equal(new Set(results.map((r) => r.body.data.fileName)).size, 12);
      assert.equal(t.filesOnDisk().length, 12);
      assert.equal(await t.rowCount(), 12);
    });
  });

  describe('multipart shape', () => {
    const png = () => new Blob(['bytes'], { type: 'image/png' });

    it('rejects a file sent under the wrong field name', async () => {
      const res = await t.uploadForm((f) => f.append('photo', png(), 'a.png'));
      await assertRejected(res, /field named "file"/);
    });

    it('rejects more than one file', async () => {
      const res = await t.uploadForm((f) => {
        f.append('file', png(), 'a.png');
        f.append('file', png(), 'b.png');
      });
      await assertRejected(res, /one file at a time/);
    });

    it('rejects a second file in a different field', async () => {
      const res = await t.uploadForm((f) => {
        f.append('file', png(), 'a.png');
        f.append('extra', png(), 'b.png');
      });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      await assertNothingStored();
    });

    it('rejects a form with fields but no file', async () => {
      const res = await t.uploadForm((f) => f.append('title', 'No file here'));
      await assertRejected(res, /file is required/);
    });

    it('rejects a JSON body sent instead of a file', async () => {
      const res = await t.request('POST', '/api/media', { title: 'json' });
      await assertRejected(res, /file is required/);
    });

    it('accepts a tags field repeated several times', async () => {
      const res = await t.uploadForm((f) => {
        f.append('title', 'Repeated tags');
        f.append('tags', 'One');
        f.append('tags', 'two');
        f.append('file', png(), 'a.png');
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.deepEqual(res.body.data.tags, ['one', 'two']);
    });
  });

  describe('metadata fields sent with the upload', () => {
    const invalid = [
      ['an empty title', { title: '' }, 'title'],
      ['a title of only spaces', { title: '    ' }, 'title'],
      ['a title over 255 characters', { title: 'x'.repeat(256) }, 'title'],
      ['a description over 5000 characters', { description: 'x'.repeat(5001) }, 'description'],
      ['a negative width', { width: '-1' }, 'width'],
      ['a zero height', { height: '0' }, 'height'],
      ['a fractional width', { width: '1.5' }, 'width'],
      ['a non-numeric width', { width: 'wide' }, 'width'],
      ['a negative duration', { duration: '-1' }, 'duration'],
      ['a non-numeric duration', { duration: 'long' }, 'duration'],
      ['21 tags', { tags: Array.from({ length: 21 }, (_, i) => `t${i}`).join(',') }, 'tags'],
      ['a tag over 50 characters', { tags: 'x'.repeat(51) }, 'tags'],
      ['an unknown field', { colour: 'red' }, 'colour'],
      ['an attempt to set the stored path', { filePath: '/etc/passwd' }, 'filePath'],
      ['an attempt to set the media type', { mediaType: 'video' }, 'mediaType'],
      ['an attempt to set the file size', { fileSize: '1' }, 'fileSize'],
      ['an attempt to set the id', { id: '7' }, 'id'],
    ];
    for (const [label, fields, field] of invalid) {
      it(`rejects ${label}, names the field, and removes the uploaded file`, async () => {
        const res = await t.upload({ fields });
        assert.equal(res.status, 400, JSON.stringify(res.body));
        assert.ok(res.body.details.some((d) => d.field === field), JSON.stringify(res.body.details));
        await assertNothingStored();
      });
    }

    it('reports every invalid field at once', async () => {
      const res = await t.upload({ fields: { title: '', width: '-1', duration: 'x', colour: 'red' } });
      assert.equal(res.status, 400);
      assert.deepEqual(res.body.details.map((d) => d.field).sort(), ['colour', 'duration', 'title', 'width']);
      await assertNothingStored();
    });

    it('accepts values exactly at the limits', async () => {
      const res = await t.upload({
        fields: {
          title: 'x'.repeat(255),
          description: 'd'.repeat(5000),
          tags: Array.from({ length: 20 }, (_, i) => `t${i}`).join(','),
          width: '1',
          height: '1',
          duration: '0',
        },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.title.length, 255);
      assert.equal(res.body.data.tags.length, 20);
    });

    it('converts and cleans valid values', async () => {
      const res = await t.upload({
        fields: { title: '   Padded   ', tags: ' Red ,GREEN, red,, ', width: '640', height: '480', duration: '12.345', description: '' },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const m = res.body.data;
      assert.equal(m.title, 'Padded');
      assert.deepEqual(m.tags, ['red', 'green']); // trimmed, lower-cased, de-duplicated
      assert.equal(m.width, 640);
      assert.equal(m.height, 480);
      assert.equal(Number(m.duration), 12.35); // rounded to 2 decimals
      assert.equal(m.description, '');
    });
  });
});
