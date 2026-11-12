const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Must be required before anything from src/ (sets the test database)
const { startTestApp } = require('./helpers/testApp');

const DAY = 86400000;
const BASE = Date.UTC(2025, 0, 1);
const TYPES = ['document', 'image', 'video', 'audio']; // index = i % 4
const MIME = {
  document: () => 'application/pdf',
  image: (i) => (i % 3 === 0 ? 'image/jpeg' : 'image/png'),
  video: () => 'video/mp4',
  audio: () => 'audio/mpeg',
};
const pad = (n) => String(n).padStart(2, '0');

// 24 rows with known, varied values. Item i is created i days after BASE, so
// "newest first" is Item 24 .. Item 01, and every size (i * 100) is different.
const buildRows = () =>
  Array.from({ length: 24 }, (_, k) => {
    const i = k + 1;
    const type = TYPES[i % 4];
    const tags = ['all', i % 2 ? 'odd' : 'even'];
    if (i % 3 === 0) tags.push('three');
    if (i <= 5) tags.push('first');
    const row = {
      title: `Item ${pad(i)}`,
      description: null,
      media_type: type,
      mime_type: MIME[type](i),
      file_size: i * 100,
      tags,
      created_at: new Date(BASE + i * DAY),
      updated_at: new Date(BASE + i * DAY),
    };
    // Rows with text worth searching for
    if (i === 15) row.title = 'Beach Sunset';
    if (i === 16) row.title = '100% Cotton';
    if (i === 17) row.title = 'under_score';
    if (i === 18) row.title = "O'Brien & Sons";
    if (i === 19) row.title = 'RÉSUMÉ Café';
    if (i === 20) row.description = 'Contains the NEEDLE word';
    if (i === 21) row.original_name = 'Holiday_Photo.PNG';
    if (i === 22) row.title = String.raw`a\b backslash`;
    return row;
  });

describe('Pagination, filtering, sorting and search', () => {
  let t;
  let rows; // the seeded rows, with ids, in insertion order (Item 01 first)

  before(async () => {
    t = await startTestApp();
    await t.reset();
    // Postgres returns bigint columns (file_size) as strings; the expected
    // values below are computed with numbers
    rows = (await t.seed(buildRows())).map((r) => ({ ...r, file_size: Number(r.file_size) }));
  });
  after(async () => {
    await t.stop();
  });

  const list = async (query = '') => {
    const res = await t.request('GET', `/api/media${query ? `?${query}` : ''}`);
    return res;
  };
  const ok = async (query) => {
    const res = await list(query);
    assert.equal(res.status, 200, `${query}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.meta.count, res.body.data.length, 'meta.count matches the page');
    return res.body;
  };
  const rejected = async (query, field) => {
    const res = await list(query);
    assert.equal(res.status, 400, `${query} should be rejected: ${JSON.stringify(res.body).slice(0, 200)}`);
    assert.equal(res.body.success, false);
    if (field) {
      assert.ok(res.body.errors.some((e) => e.source === 'query' && e.field === field), JSON.stringify(res.body.errors));
    }
    return res.body;
  };

  const ids = (body) => body.data.map((m) => m.id);
  const sortedIds = (list_) => [...list_].sort((a, b) => a - b);
  // Reference model: ids of the rows matching a predicate, newest first
  const expected = (predicate = () => true) =>
    rows.filter(predicate).sort((a, b) => b.created_at - a.created_at).map((r) => r.id);
  const iso = (row) => encodeURIComponent(row.created_at.toISOString());
  const rowByTitle = (title) => rows.find((r) => r.title === title);

  describe('pagination', () => {
    it('returns the first page of 20 by default, newest first', async () => {
      const body = await ok('');
      assert.equal(body.data.length, 20);
      assert.deepEqual(ids(body), expected().slice(0, 20));
      assert.deepEqual(body.meta.pagination, { page: 1, limit: 20, total: 24, totalPages: 2, hasNext: true, hasPrev: false });
    });

    it('returns the remaining rows on the last page', async () => {
      const body = await ok('page=2');
      assert.deepEqual(ids(body), expected().slice(20));
      assert.deepEqual(body.meta.pagination, { page: 2, limit: 20, total: 24, totalPages: 2, hasNext: false, hasPrev: true });
    });

    it('walks every page exactly once with no duplicates or gaps', async () => {
      const seen = [];
      for (let page = 1; page <= 5; page++) {
        const body = await ok(`limit=5&page=${page}`);
        assert.equal(body.meta.pagination.totalPages, 5);
        assert.equal(body.meta.pagination.hasNext, page < 5);
        assert.equal(body.meta.pagination.hasPrev, page > 1);
        seen.push(...ids(body));
      }
      assert.deepEqual(seen, expected());
    });

    it('returns an empty page (not an error) past the last page', async () => {
      const body = await ok('page=99&limit=5');
      assert.deepEqual(body.data, []);
      assert.equal(body.meta.pagination.total, 24);
      assert.equal(body.meta.pagination.hasNext, false);
    });

    it('supports limit and offset', async () => {
      const body = await ok('limit=10&offset=20');
      assert.deepEqual(ids(body), expected().slice(20));
      assert.equal(body.meta.pagination.page, 3);
      assert.deepEqual(ids(await ok('limit=3&offset=4')), expected().slice(4, 7));
    });

    it('accepts the maximum limit of 100 and one row per page', async () => {
      assert.equal((await ok('limit=100')).data.length, 24);
      const body = await ok('limit=1');
      assert.equal(body.data.length, 1);
      assert.equal(body.meta.pagination.totalPages, 24);
    });

    it('reports the total of the filtered result, not of the whole table', async () => {
      const body = await ok('mediaType=image&limit=2');
      const images = expected((r) => r.media_type === 'image');
      assert.equal(body.meta.pagination.total, images.length);
      assert.equal(body.meta.pagination.totalPages, Math.ceil(images.length / 2));
    });

    it('treats empty values like omitted ones', async () => {
      const body = await ok('page=&limit=&offset=');
      assert.equal(body.meta.pagination.limit, 20);
      assert.equal(body.data.length, 20);
    });

    it('accepts numbers sent as strings with spaces or leading zeros', async () => {
      assert.equal((await ok('limit=005&page=02')).meta.pagination.page, 2);
    });

    for (const [label, query, field] of [
      ['page 0', 'page=0', 'page'],
      ['a negative page', 'page=-1', 'page'],
      ['a fractional page', 'page=1.5', 'page'],
      ['a non-numeric page', 'page=abc', 'page'],
      ['limit 0', 'limit=0', 'limit'],
      ['a negative limit', 'limit=-5', 'limit'],
      ['a limit over 100', 'limit=101', 'limit'],
      ['a huge limit', 'limit=1000000', 'limit'],
      ['a non-numeric limit', 'limit=all', 'limit'],
      ['a negative offset', 'offset=-1', 'offset'],
      ['a non-numeric offset', 'offset=abc', 'offset'],
    ]) {
      it(`rejects ${label}`, async () => {
        await rejected(query, field);
      });
    }

    it('rejects page and offset together', async () => {
      const body = await rejected('page=2&offset=10');
      assert.match(body.message, /either page or offset/);
    });

    it('reports every invalid parameter at once', async () => {
      const body = await rejected('page=0&limit=0&sortOrder=x');
      assert.deepEqual(body.errors.map((e) => e.field).sort(), ['limit', 'page', 'sortOrder']);
    });
  });

  describe('sorting', () => {
    it('sorts newest first by default', async () => {
      const body = await ok('limit=100');
      assert.equal(body.data[0].title, 'Item 24');
      assert.deepEqual(ids(body), expected());
    });

    it('sorts oldest first with sortOrder=asc', async () => {
      const body = await ok('limit=100&sortOrder=asc');
      assert.deepEqual(ids(body), expected().reverse());
    });

    it('accepts sortOrder in any letter case', async () => {
      assert.deepEqual(ids(await ok('limit=100&sortOrder=ASC')), expected().reverse());
      assert.deepEqual(ids(await ok('limit=100&sortOrder=Desc')), expected());
    });

    it('sorts by file size in both directions', async () => {
      const asc = await ok('limit=100&sortBy=file_size&sortOrder=asc');
      assert.deepEqual(asc.data.map((m) => Number(m.file_size)), rows.map((r) => r.file_size)); // 100..2400
      const desc = await ok('limit=100&sortBy=file_size&sortOrder=desc');
      assert.deepEqual(desc.data.map((m) => Number(m.file_size)), rows.map((r) => r.file_size).reverse());
    });

    it('sorts by title', async () => {
      const plain = 'tag=first'; // Item 01 .. Item 05, plain ASCII titles
      assert.deepEqual((await ok(`${plain}&sortBy=title&sortOrder=asc`)).data.map((m) => m.title), ['Item 01', 'Item 02', 'Item 03', 'Item 04', 'Item 05']);
      assert.deepEqual((await ok(`${plain}&sortBy=title&sortOrder=desc`)).data.map((m) => m.title), ['Item 05', 'Item 04', 'Item 03', 'Item 02', 'Item 01']);
    });

    it('sorts by the other allowed columns', async () => {
      for (const column of ['created_at', 'updated_at', 'media_type', 'original_name', 'title', 'file_size']) {
        const body = await ok(`limit=100&sortBy=${column}`);
        assert.equal(body.data.length, 24, column);
      }
    });

    it('breaks ties by id, so paging through equal values never repeats or skips a row', async () => {
      // 6 rows per media type: sorting by media_type is full of ties.
      // (A stricter version, with rows stored in scrambled order, is at the
      // end of this file.)
      const seen = [];
      for (let page = 1; page <= 6; page++) seen.push(...ids(await ok(`sortBy=media_type&limit=4&page=${page}`)));
      assert.equal(seen.length, 24);
      assert.deepEqual(sortedIds(seen), sortedIds(rows.map((r) => r.id)), 'every row exactly once');

      // within a group of equal values the order is by id, in the sort direction
      const asc = (await ok('limit=100&sortBy=media_type&sortOrder=asc')).data;
      for (let n = 1; n < asc.length; n++) {
        if (asc[n].media_type === asc[n - 1].media_type) assert.ok(asc[n].id > asc[n - 1].id, 'asc ties ascend by id');
      }
      const desc = (await ok('limit=100&sortBy=media_type&sortOrder=desc')).data;
      for (let n = 1; n < desc.length; n++) {
        if (desc[n].media_type === desc[n - 1].media_type) assert.ok(desc[n].id < desc[n - 1].id, 'desc ties descend by id');
      }
    });

    it('sorts the filtered result, not the whole table', async () => {
      const body = await ok('tag=odd&limit=100&sortBy=file_size&sortOrder=desc');
      const odd = rows.filter((r) => r.tags.includes('odd')).map((r) => r.file_size).sort((a, b) => b - a);
      assert.deepEqual(body.data.map((m) => Number(m.file_size)), odd);
    });

    for (const [label, query] of [
      ['an unknown column', 'sortBy=password'],
      ['a column that exists but is not sortable', 'sortBy=file_path'],
      ['a camelCase column name', 'sortBy=createdAt'],
      ['a SQL injection attempt', `sortBy=${encodeURIComponent('title; DROP TABLE media_assets; --')}`],
      ['a SQL expression', `sortBy=${encodeURIComponent('(SELECT 1)')}`],
    ]) {
      it(`rejects sortBy with ${label}`, async () => {
        await rejected(query, 'sortBy');
      });
    }

    it('rejects an invalid sortOrder', async () => {
      await rejected('sortOrder=sideways', 'sortOrder');
      await rejected(`sortOrder=${encodeURIComponent('asc; DROP TABLE media_assets')}`, 'sortOrder');
    });

    it('left the table intact after the injection attempts', async () => {
      assert.equal(await t.rowCount(), 24);
    });
  });

  describe('filtering', () => {
    it('filters by one media type', async () => {
      const body = await ok('mediaType=image&limit=100');
      assert.deepEqual(ids(body), expected((r) => r.media_type === 'image'));
      assert.ok(body.data.every((m) => m.media_type === 'image'));
    });

    it('filters by several media types, as a comma list or a repeated parameter', async () => {
      const want = expected((r) => ['image', 'video'].includes(r.media_type));
      assert.deepEqual(ids(await ok('mediaType=image,video&limit=100')), want);
      assert.deepEqual(ids(await ok('mediaType=image&mediaType=video&limit=100')), want);
      assert.deepEqual(ids(await ok('mediaType=Image,%20VIDEO&limit=100')), want); // case and spaces
    });

    it('rejects an unknown media type', async () => {
      await rejected('mediaType=gif', 'mediaType');
      await rejected('mediaType=image,gif', 'mediaType');
      await rejected('mediaType=image;video', 'mediaType');
    });

    it('filters by exact MIME type, ignoring case', async () => {
      const want = expected((r) => r.mime_type === 'image/jpeg');
      assert.ok(want.length > 0);
      assert.deepEqual(ids(await ok('mimeType=image/jpeg&limit=100')), want);
      assert.deepEqual(ids(await ok('mimeType=IMAGE/JPEG&limit=100')), want);
    });

    it('rejects a malformed MIME type', async () => {
      await rejected('mimeType=jpeg', 'mimeType');
      await rejected('mimeType=a/b/c', 'mimeType');
    });

    it('filters by a single tag', async () => {
      assert.deepEqual(ids(await ok('tag=three&limit=100')), expected((r) => r.tags.includes('three')));
      assert.deepEqual(ids(await ok('tag=THREE&limit=100')), expected((r) => r.tags.includes('three')));
    });

    it('filters by ALL of several tags', async () => {
      const want = expected((r) => r.tags.includes('odd') && r.tags.includes('three'));
      assert.ok(want.length > 0);
      assert.deepEqual(ids(await ok('tags=odd,three&limit=100')), want);
    });

    it('filters by ANY of several tags', async () => {
      const want = expected((r) => r.tags.includes('first') || r.tags.includes('three'));
      assert.deepEqual(ids(await ok('anyTags=first,three&limit=100')), want);
    });

    it('combines tag, tags and anyTags', async () => {
      const want = expected((r) => r.tags.includes('all') && r.tags.includes('odd') && r.tags.includes('three') && (r.tags.includes('first') || r.tags.includes('even')));
      assert.deepEqual(ids(await ok('tag=all&tags=odd,three&anyTags=first,even&limit=100')), want);
    });

    it('returns nothing for a tag nobody has', async () => {
      const body = await ok('tag=nonexistent');
      assert.deepEqual(body.data, []);
      assert.equal(body.meta.pagination.total, 0);
      assert.equal(body.meta.pagination.totalPages, 0);
    });

    it('rejects malformed tag filters', async () => {
      await rejected('tag=a,b', 'tag');
      await rejected(`tag=${'x'.repeat(51)}`, 'tag');
      await rejected(`tags=${Array.from({ length: 21 }, (_, i) => `t${i}`).join(',')}`, 'tags');
    });

    it('filters by size range, inclusive at both ends', async () => {
      const want = expected((r) => r.file_size >= 500 && r.file_size <= 900);
      assert.equal(want.length, 5);
      assert.deepEqual(ids(await ok('minSize=500&maxSize=900&limit=100')), want);
      assert.deepEqual(ids(await ok('minSize=500&maxSize=500')), expected((r) => r.file_size === 500));
    });

    it('accepts minSize or maxSize on their own', async () => {
      assert.deepEqual(ids(await ok('minSize=2200&limit=100')), expected((r) => r.file_size >= 2200));
      assert.deepEqual(ids(await ok('maxSize=250&limit=100')), expected((r) => r.file_size <= 250));
    });

    it('rejects invalid size filters', async () => {
      await rejected('minSize=-1', 'minSize');
      await rejected('minSize=abc', 'minSize');
      await rejected('maxSize=1.5', 'maxSize');
      const body = await rejected('minSize=900&maxSize=100', 'maxSize');
      assert.match(JSON.stringify(body.errors), /maxSize cannot be less than minSize/);
    });

    it('filters by creation date range, inclusive at both ends', async () => {
      const from = rows[9]; // Item 10
      const to = rows[13]; // Item 14
      const want = expected((r) => r.created_at >= from.created_at && r.created_at <= to.created_at);
      assert.equal(want.length, 5);
      assert.deepEqual(ids(await ok(`createdFrom=${iso(from)}&createdTo=${iso(to)}&limit=100`)), want);
    });

    it('accepts createdFrom or createdTo on their own, and plain dates', async () => {
      const cut = rows[19]; // Item 20
      assert.deepEqual(ids(await ok(`createdFrom=${iso(cut)}&limit=100`)), expected((r) => r.created_at >= cut.created_at));
      assert.deepEqual(ids(await ok(`createdTo=${iso(cut)}&limit=100`)), expected((r) => r.created_at <= cut.created_at));
      // plain date: midnight UTC on 2025-01-11 is exactly Item 10
      assert.deepEqual(ids(await ok('createdFrom=2025-01-11&createdTo=2025-01-11')), [rows[9].id]);
    });

    it('rejects invalid dates', async () => {
      await rejected('createdFrom=yesterday', 'createdFrom');
      await rejected('createdTo=2025-13-45', 'createdTo');
      const body = await rejected('createdFrom=2025-02-01&createdTo=2025-01-01', 'createdTo');
      assert.match(JSON.stringify(body.errors), /createdTo cannot be before createdFrom/);
    });

    it('combines every filter with AND', async () => {
      const want = expected(
        (r) => r.media_type === 'image' && r.tags.includes('odd') && r.file_size >= 500 && r.file_size <= 2000 && r.created_at >= new Date(BASE + 3 * DAY)
      );
      assert.ok(want.length > 0, 'the combination must match something to be a meaningful test');
      const query = `mediaType=image&tag=odd&minSize=500&maxSize=2000&createdFrom=${encodeURIComponent(new Date(BASE + 3 * DAY).toISOString())}&limit=100`;
      assert.deepEqual(ids(await ok(query)), want);
    });

    it('combines filters with sorting and paging', async () => {
      const matching = rows.filter((r) => r.tags.includes('odd')).sort((a, b) => a.file_size - b.file_size);
      const body = await ok('tag=odd&sortBy=file_size&sortOrder=asc&limit=5&page=2');
      assert.deepEqual(ids(body), matching.slice(5, 10).map((r) => r.id));
      assert.equal(body.meta.pagination.total, matching.length);
    });

    it('ignores empty filter values', async () => {
      const query = 'search=&mediaType=&mimeType=&tag=&tags=&anyTags=&minSize=&maxSize=&createdFrom=&createdTo=&sortBy=&sortOrder=&page=&limit=';
      assert.equal((await ok(query)).meta.pagination.total, 24);
    });

    it('rejects unknown query parameters', async () => {
      const body = await rejected('colour=red', 'colour');
      assert.match(JSON.stringify(body.errors), /not allowed/);
    });
  });

  describe('search', () => {
    const titles = (body) => body.data.map((m) => m.title);

    it('finds text in the title, ignoring case', async () => {
      assert.deepEqual(titles(await ok('search=Beach%20Sunset')), ['Beach Sunset']);
      assert.deepEqual(titles(await ok('search=BEACH%20SUNSET')), ['Beach Sunset']);
      assert.deepEqual(titles(await ok('search=beach%20sunset')), ['Beach Sunset']);
    });

    it('finds part of a word', async () => {
      assert.deepEqual(titles(await ok('search=ach%20sun')), ['Beach Sunset']);
    });

    it('finds text in the description', async () => {
      const body = await ok('search=needle');
      assert.deepEqual(ids(body), [rows[19].id]); // Item 20
    });

    it('finds text in the original file name', async () => {
      const body = await ok('search=holiday_photo');
      assert.deepEqual(ids(body), [rows[20].id]); // Item 21
    });

    it('matches several rows and counts them', async () => {
      const body = await ok('search=item&limit=100');
      assert.equal(body.meta.pagination.total, rows.filter((r) => /item/i.test(r.title)).length);
    });

    it('returns nothing, with a valid empty result, when nothing matches', async () => {
      const body = await ok('search=zzz-no-such-text');
      assert.deepEqual(body.data, []);
      assert.equal(body.meta.pagination.total, 0);
    });

    it('treats % as a literal character, not a wildcard', async () => {
      assert.deepEqual(titles(await ok('search=%25')), ['100% Cotton']); // %25 is an encoded %
      assert.deepEqual(titles(await ok('search=100%25')), ['100% Cotton']);
      assert.deepEqual((await ok('search=%25%25')).data, []);
    });

    it('treats _ as a literal character, not a single-character wildcard', async () => {
      const body = await ok('search=_&limit=100');
      assert.deepEqual(sortedIds(ids(body)), sortedIds([rowByTitle('under_score').id, rows[20].id]));
      assert.deepEqual(titles(await ok('search=under_score')), ['under_score']);
      assert.deepEqual((await ok('search=under-score')).data, []);
    });

    it('treats a backslash as a literal character', async () => {
      assert.deepEqual(titles(await ok(`search=${encodeURIComponent('\\')}`)), [String.raw`a\b backslash`]);
    });

    it('handles apostrophes and ampersands', async () => {
      assert.deepEqual(titles(await ok(`search=${encodeURIComponent("O'Brien")}`)), ["O'Brien & Sons"]);
      assert.deepEqual(titles(await ok(`search=${encodeURIComponent('& Sons')}`)), ["O'Brien & Sons"]);
    });

    it('is not vulnerable to SQL injection', async () => {
      for (const attack of ["'; DROP TABLE media_assets; --", "' OR '1'='1", '" OR 1=1 --', '%27%20OR%201=1']) {
        const body = await ok(`search=${encodeURIComponent(attack)}`);
        assert.deepEqual(body.data, [], `injection string must be searched for literally: ${attack}`);
      }
      assert.equal(await t.rowCount(), 24, 'table intact');
    });

    it('finds accented and non-Latin text', async () => {
      assert.deepEqual(titles(await ok(`search=${encodeURIComponent('Café')}`)), ['RÉSUMÉ Café']);
      assert.deepEqual(titles(await ok(`search=${encodeURIComponent('RÉSUMÉ')}`)), ['RÉSUMÉ Café']);
    });

    it('treats a whitespace-only search as no search', async () => {
      assert.equal((await ok('search=%20%20%20')).meta.pagination.total, 24);
    });

    it('trims spaces around the search text', async () => {
      assert.deepEqual(titles(await ok('search=%20%20beach%20sunset%20%20')), ['Beach Sunset']);
    });

    it('accepts a 255 character search and rejects a longer one', async () => {
      assert.deepEqual((await ok(`search=${'a'.repeat(255)}`)).data, []);
      await rejected(`search=${'a'.repeat(256)}`, 'search');
    });

    it('combines search with filters, sorting and paging', async () => {
      const matching = rows.filter((r) => /item/i.test(r.title) && r.media_type === 'video').sort((a, b) => a.file_size - b.file_size);
      const body = await ok('search=item&mediaType=video&sortBy=file_size&sortOrder=asc&limit=2&page=2');
      assert.deepEqual(ids(body), matching.slice(2, 4).map((r) => r.id));
      assert.equal(body.meta.pagination.total, matching.length);
    });
  });

  // Runs last because it replaces the seeded data
  describe('sorting rows that all have the same value', () => {
    let tied; // ids 1..24

    before(async () => {
      await t.reset();
      // Insert with explicit ids in a scrambled order, so each row's position in
      // the table differs from its id. Without an explicit id tie-breaker in the
      // query, Postgres would return equal values in that scrambled order.
      const order = Array.from({ length: 24 }, (_, k) => k + 1).sort((a, b) => ((a * 7) % 24) - ((b * 7) % 24));
      assert.notDeepEqual(order, [...order].sort((a, b) => a - b), 'the insertion order must really be scrambled');
      tied = await t.seed(order.map((id) => ({ id, title: `Tie ${pad(id)}`, media_type: 'image', file_size: 100 })));
    });

    const listed = async (query) => ids(await ok(`limit=100&${query}`));
    const byId = (dir) => Array.from({ length: 24 }, (_, k) => (dir === 'asc' ? k + 1 : 24 - k));

    it('orders equal values by id in the direction of the sort', async () => {
      // every row has the same media_type and file_size, so only the tie-breaker decides
      assert.deepEqual(await listed('sortBy=media_type&sortOrder=asc'), byId('asc'));
      assert.deepEqual(await listed('sortBy=media_type&sortOrder=desc'), byId('desc'));
      assert.deepEqual(await listed('sortBy=file_size&sortOrder=asc'), byId('asc'));
      assert.deepEqual(await listed('sortBy=file_size&sortOrder=desc'), byId('desc'));
    });

    it('pages through equal values without repeating or skipping a row', async () => {
      for (const sort of ['sortBy=file_size&sortOrder=asc', 'sortBy=file_size&sortOrder=desc']) {
        const seen = [];
        for (let page = 1; page <= 5; page++) seen.push(...ids(await ok(`${sort}&limit=5&page=${page}`)));
        assert.deepEqual(seen, sort.includes('asc') ? byId('asc') : byId('desc'), sort);
      }
      assert.equal(tied.length, 24);
    });
  });
});
