const { pool } = require('../config/db');
const { DEFAULT_LIMIT, MAX_LIMIT } = require('../config/constants');
const Media = require('../models/Media');

// The repository works with API-style objects (camelCase: filePath, mediaType...).
// Media.toColumns / Media.fromRow translate to and from the database columns, so
// column names never leak out of this layer. Writable fields are whitelisted by
// the model: id and the timestamps can never be set by a caller.

// Create a media asset and return it
const create = async (data) => {
  const written = Media.toColumns(data);
  const columns = Object.keys(written);
  const values = columns.map((c) => written[c]);
  const placeholders = columns.map((_, i) => `$${i + 1}`);

  const { rows } = await pool.query(
    `INSERT INTO media_assets (${columns.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values
  );
  return Media.fromRow(rows[0]);
};

// Parse a positive integer, falling back to a default for missing/invalid input
const toPositiveInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Parse a non-negative integer (0 is allowed), falling back to 0
const toOffset = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Escape LIKE wildcards so a search for "100%" or "a_b" matches literally
const escapeLike = (text) => text.replace(/[\\%_]/g, String.raw`\$&`);

const toArray = (value) => (Array.isArray(value) ? value : [value]);

// Build a parameterised WHERE clause from the supported filters.
const buildWhere = (filters) => {
  const {
    category, // exact category, e.g. 'marketing'
    mediaType, // string or array: 'image' | ['image', 'document']
    mimeType, // exact, e.g. 'image/png'
    tag, // single tag the asset must have
    tags, // array: asset must have ALL of these tags
    anyTags, // array: asset must have AT LEAST ONE of these tags
    search, // case-insensitive text in title, description or original name
    minSize, // bytes
    maxSize, // bytes
    createdFrom, // inclusive, Date or ISO string
    createdTo, // inclusive, Date or ISO string
  } = filters;

  const conditions = [];
  const values = [];
  const param = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (category) conditions.push(`category = ${param(category)}::media_category`);
  if (mediaType) conditions.push(`media_type = ANY(${param(toArray(mediaType))}::media_type[])`);
  if (mimeType) conditions.push(`mime_type = ${param(mimeType)}`);

  const allTags = [...(tag ? [tag] : []), ...(tags || [])];
  if (allTags.length) conditions.push(`tags @> ${param(allTags)}::text[]`);
  if (anyTags?.length) conditions.push(`tags && ${param(anyTags)}::text[]`);

  if (search) {
    const p = param(`%${escapeLike(search)}%`);
    conditions.push(
      `(title ILIKE ${p} OR description ILIKE ${p} OR original_name ILIKE ${p})`
    );
  }

  if (minSize !== undefined) conditions.push(`file_size >= ${param(minSize)}`);
  if (maxSize !== undefined) conditions.push(`file_size <= ${param(maxSize)}`);
  if (createdFrom) conditions.push(`created_at >= ${param(createdFrom)}`);
  if (createdTo) conditions.push(`created_at <= ${param(createdTo)}`);

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
};

// Search, filter, sort and paginate media assets.
// Filters are optional and combine with AND (see buildWhere for the list).
//
// Sorting: sortBy (one of the SORT_FIELDS, default createdAt) and
// sortOrder ('asc' | 'desc', default desc). id breaks ties so pages never
// overlap or skip rows when many rows share the same sort value.
//
// Pagination: either page (1-based) + limit, or limit + offset.
// limit defaults to DEFAULT_LIMIT and is capped at MAX_LIMIT; invalid
// values fall back to the defaults. If page is given it wins over offset.
//
// Returns { items, total, pagination } where total is the number of rows
// matching the filters (ignoring paging) and pagination is
// { page, limit, total, totalPages, hasNext, hasPrev }.
const findAll = async (filters = {}) => {
  const { sortBy, sortOrder } = filters;
  const { where, values } = buildWhere(filters);

  const column = Media.sortColumn(sortBy);
  const direction = String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const limit = Math.min(toPositiveInt(filters.limit, DEFAULT_LIMIT), MAX_LIMIT);
  const usePage = filters.page !== undefined;
  const page = usePage
    ? toPositiveInt(filters.page, 1)
    : Math.floor(toOffset(filters.offset) / limit) + 1;
  const offset = usePage ? (page - 1) * limit : toOffset(filters.offset);

  // The total count and the requested page do not depend on each other, so
  // they run at the same time on two pooled connections instead of one after
  // the other: the request takes as long as the slower query, not the sum.
  // (If either fails, Promise.all rejects right away and the error handler
  // takes over.) The two queries are not one snapshot, so under concurrent
  // writes the total can differ by a row from the page; fine for pagination.
  const [countResult, pageResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM media_assets ${where}`, values),
    pool.query(
      `SELECT * FROM media_assets ${where}
       ORDER BY ${column} ${direction}, id ${direction}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    ),
  ]);
  const total = countResult.rows[0].total;
  const rows = pageResult.rows.map(Media.fromRow);

  const totalPages = Math.ceil(total / limit);

  return {
    items: rows,
    total,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
};

// All distinct tags with how many assets use each, most used first.
// Useful for building a tag filter.
const getTags = async () => {
  const { rows } = await pool.query(
    `SELECT tag, COUNT(*)::int AS count
     FROM media_assets, UNNEST(tags) AS tag
     GROUP BY tag
     ORDER BY count DESC, tag ASC`
  );
  return rows;
};

// Get one media asset by id, or null if it does not exist
const findById = async (id) => {
  const { rows } = await pool.query('SELECT * FROM media_assets WHERE id = $1', [id]);
  return Media.fromRow(rows[0]);
};

// Update only the provided fields. Returns the updated asset, or null if the
// id does not exist. With nothing to update it just returns the current one.
const update = async (id, data) => {
  const written = Media.toColumns(data);
  const columns = Object.keys(written);
  if (columns.length === 0) return findById(id);

  const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const values = columns.map((c) => written[c]);

  const { rows } = await pool.query(
    `UPDATE media_assets SET ${setClause}
     WHERE id = $${columns.length + 1}
     RETURNING *`,
    [...values, id]
  );
  return Media.fromRow(rows[0]);
};

// Delete a media asset. Returns the deleted asset (so the caller can remove
// the file from disk), or null if the id does not exist.
const remove = async (id) => {
  const { rows } = await pool.query(
    'DELETE FROM media_assets WHERE id = $1 RETURNING *',
    [id]
  );
  return Media.fromRow(rows[0]);
};

// Delete several media assets. Returns the deleted assets (so the caller can
// remove their files); ids that do not exist are simply absent.
const removeMany = async (ids) => {
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    'DELETE FROM media_assets WHERE id = ANY($1::int[]) RETURNING *',
    [ids]
  );
  return rows.map(Media.fromRow);
};

// Apply the same metadata changes to several assets at once.
// Returns the updated assets (ids that do not exist are simply absent).
const updateMany = async (ids, data) => {
  const written = Media.toColumns(data);
  const columns = Object.keys(written);
  if (columns.length === 0 || ids.length === 0) return [];

  const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const values = columns.map((c) => written[c]);

  const { rows } = await pool.query(
    `UPDATE media_assets SET ${setClause}
     WHERE id = ANY($${columns.length + 1}::int[])
     RETURNING *`,
    [...values, ids]
  );
  return rows.map(Media.fromRow);
};

// Rename a tag on every asset that has it. If an asset already has the new
// tag, the two merge (no duplicates) and the original tag order is kept.
// Returns the number of assets changed.
const renameTag = async (oldTag, newTag) => {
  const { rowCount } = await pool.query(
    `UPDATE media_assets
     SET tags = ARRAY(
       SELECT t FROM unnest(array_replace(tags, $1::text, $2::text))
         WITH ORDINALITY AS x(t, pos)
       GROUP BY t ORDER BY MIN(pos)
     )
     WHERE $1::text = ANY(tags)`,
    [oldTag, newTag]
  );
  return rowCount;
};

// Remove a tag from every asset that has it. Returns the number changed.
const deleteTag = async (tag) => {
  const { rowCount } = await pool.query(
    `UPDATE media_assets
     SET tags = array_remove(tags, $1::text)
     WHERE $1::text = ANY(tags)`,
    [tag]
  );
  return rowCount;
};

module.exports = {
  create,
  findAll,
  getTags,
  findById,
  update,
  updateMany,
  renameTag,
  deleteTag,
  remove,
  removeMany,
};
