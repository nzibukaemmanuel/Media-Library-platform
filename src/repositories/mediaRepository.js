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

// List media assets, newest first, with optional filters and pagination.
// Returns { items, total } where total ignores limit/offset.
const findAll = async ({ mediaType, tag, search, limit = 20, offset = 0 } = {}) => {
  const conditions = [];
  const values = [];

  if (mediaType) {
    values.push(mediaType);
    conditions.push(`media_type = $${values.length}`);
  }
  if (tag) {
    values.push(tag);
    conditions.push(`$${values.length} = ANY(tags)`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(
      `(title ILIKE $${values.length} OR description ILIKE $${values.length})`
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM media_assets ${where}`,
    values
  );

  const { rows } = await pool.query(
    `SELECT * FROM media_assets ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset]
  );

  return { items: rows, total: countResult.rows[0].total };
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
  findById,
  update,
  remove,
};
