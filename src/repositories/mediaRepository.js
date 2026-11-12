const { pool } = require('../config/db');

// Columns a caller may set on create / change on update (never id or timestamps)
const WRITABLE_COLUMNS = [
  'title',
  'description',
  'media_type',
  'file_name',
  'original_name',
  'file_path',
  'mime_type',
  'file_size',
  'width',
  'height',
  'duration',
  'tags',
];

// Create a media asset and return the inserted row
const create = async (data) => {
  const columns = WRITABLE_COLUMNS.filter((c) => data[c] !== undefined);
  const values = columns.map((c) => data[c]);
  const placeholders = columns.map((_, i) => `$${i + 1}`);

  const { rows } = await pool.query(
    `INSERT INTO media_assets (${columns.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values
  );
  return rows[0];
};

// Columns results can be sorted by (whitelist: the column name is placed
// into the SQL text, so it must never come straight from user input)
const SORTABLE_COLUMNS = new Set(['created_at', 'updated_at', 'title', 'file_size']);

// Escape LIKE wildcards so a search for "100%" or "a_b" matches literally
const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

const toArray = (value) => (Array.isArray(value) ? value : [value]);

// Build a parameterised WHERE clause from the supported filters.
const buildWhere = (filters) => {
  const {
    mediaType, // string or array: 'image' | ['image', 'video']
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

// Search and filter media assets with sorting and pagination.
// All filters are optional and combine with AND (see buildWhere for the list).
// Sorting: sortBy (one of SORTABLE_COLUMNS, default created_at) and
// sortOrder ('asc' | 'desc', default desc); id breaks ties for stable paging.
// Returns { items, total } where total ignores limit/offset.
const findAll = async (filters = {}) => {
  const { sortBy, sortOrder, limit = 20, offset = 0 } = filters;
  const { where, values } = buildWhere(filters);

  const column = SORTABLE_COLUMNS.has(sortBy) ? sortBy : 'created_at';
  const direction = String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM media_assets ${where}`,
    values
  );

  const { rows } = await pool.query(
    `SELECT * FROM media_assets ${where}
     ORDER BY ${column} ${direction}, id ${direction}
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset]
  );

  return { items: rows, total: countResult.rows[0].total };
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
  return rows[0] || null;
};

// Update only the provided fields. Returns the updated row, or null if the
// id does not exist. With nothing to update it just returns the current row.
const update = async (id, data) => {
  const columns = WRITABLE_COLUMNS.filter((c) => data[c] !== undefined);
  if (columns.length === 0) return findById(id);

  const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const values = columns.map((c) => data[c]);

  const { rows } = await pool.query(
    `UPDATE media_assets SET ${setClause}
     WHERE id = $${columns.length + 1}
     RETURNING *`,
    [...values, id]
  );
  return rows[0] || null;
};

// Delete a media asset. Returns the deleted row (so the caller can remove
// the file from disk), or null if the id does not exist.
const remove = async (id) => {
  const { rows } = await pool.query(
    'DELETE FROM media_assets WHERE id = $1 RETURNING *',
    [id]
  );
  return rows[0] || null;
};

module.exports = {
  create,
  findAll,
  getTags,
  findById,
  update,
  remove,
};
