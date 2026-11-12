// Limits and allowed values shared by the validation schemas, the service
// and the repository, so a rule is defined in exactly one place.

// Kinds of media (must match the media_type enum in database/schema.sql)
const MEDIA_TYPES = ['image', 'video', 'audio', 'document'];

// Columns results can be sorted by. The repository puts the column name into
// the SQL text, so only these exact values may ever be used.
const SORTABLE_COLUMNS = [
  'created_at',
  'updated_at',
  'title',
  'file_size',
  'media_type',
  'original_name',
];

const SORT_ORDERS = ['asc', 'desc'];

// Text and tag limits
const MAX_TITLE_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

// Pagination
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Most assets one bulk request may touch
const MAX_BULK = 100;

module.exports = {
  MEDIA_TYPES,
  SORTABLE_COLUMNS,
  SORT_ORDERS,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_BULK,
};
