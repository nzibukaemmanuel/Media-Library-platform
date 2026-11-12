// The Media model: what a media asset looks like in the API and how it maps to
// the media_assets table (src/database/schema.sql).
//
// The database uses snake_case columns (file_path); the API uses camelCase
// fields (filePath). This is the only place that knows both names, so the
// repository can work with plain API-style objects and never leak column
// names into the rest of the application.

const { CATEGORIES, DEFAULT_CATEGORY } = require('../config/constants');

// API field -> database column
const FIELD_TO_COLUMN = {
  id: 'id',
  title: 'title',
  description: 'description',
  category: 'category',
  mediaType: 'media_type',
  fileName: 'file_name',
  originalName: 'original_name',
  filePath: 'file_path',
  mimeType: 'mime_type',
  fileSize: 'file_size',
  width: 'width',
  height: 'height',
  duration: 'duration',
  tags: 'tags',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

// Fields a caller may write. id and the timestamps are managed by the database.
const WRITABLE_FIELDS = [
  'title',
  'description',
  'category',
  'mediaType',
  'fileName',
  'originalName',
  'filePath',
  'mimeType',
  'fileSize',
  'width',
  'height',
  'duration',
  'tags',
];

const COLUMN_TO_FIELD = Object.fromEntries(
  Object.entries(FIELD_TO_COLUMN).map(([field, column]) => [column, field])
);

// PostgreSQL returns bigint (file_size) and numeric (duration) columns as
// strings to avoid losing precision; a file size or a duration in seconds is
// always far inside the safe integer range, so give clients real numbers.
const toNumberOrNull = (value) => (value === null || value === undefined ? null : Number(value));

// Database row -> API object (camelCase, numbers as numbers)
const fromRow = (row) => {
  if (!row) return null;
  const media = {};
  for (const [column, value] of Object.entries(row)) {
    media[COLUMN_TO_FIELD[column] ?? column] = value;
  }
  media.fileSize = toNumberOrNull(media.fileSize);
  media.duration = toNumberOrNull(media.duration);
  return media;
};

// API-style data -> { column: value } for an INSERT or UPDATE.
// Unknown fields and undefined values are dropped.
const toColumns = (data) => {
  const columns = {};
  for (const field of WRITABLE_FIELDS) {
    if (data[field] !== undefined) columns[FIELD_TO_COLUMN[field]] = data[field];
  }
  return columns;
};

// The column to ORDER BY for an API field name; created_at for anything else.
// Only ever returns one of the known column names, never user input.
const sortColumn = (field) => {
  const column = FIELD_TO_COLUMN[field];
  return column && field !== 'id' ? column : 'created_at';
};

module.exports = {
  CATEGORIES,
  DEFAULT_CATEGORY,
  WRITABLE_FIELDS,
  fromRow,
  toColumns,
  sortColumn,
};
