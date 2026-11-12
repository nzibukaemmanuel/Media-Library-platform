// Limits and allowed values shared by the validation schemas, the service
// and the repository, so a rule is defined in exactly one place.

// Kinds of media an upload can be classified as. The media_type enum in
// database/schema.sql also lists video and audio, which are not accepted now.
const MEDIA_TYPES = ['image', 'document'];

// Categories a media item can belong to (must match the media_category enum
// in database/schema.sql). A new item is "general" unless it says otherwise.
const CATEGORIES = ['general', 'marketing', 'design', 'documentation', 'reports', 'other'];
const DEFAULT_CATEGORY = 'general';

// Fields results can be sorted by (API field names, see models/Media.js). The
// repository turns them into column names for the SQL text, so only these
// exact values may ever be used.
const SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'title',
  'fileSize',
  'mediaType',
  'originalName',
  'category',
];

// The only file types an upload may have. Each MIME type lists the kind of
// media it becomes and the file extensions allowed for it. The MIME type is
// sent by the client and can be faked, so the extension must agree with it.
// SVG, HTML and scripts are deliberately absent: they can carry executable
// code if served back to a browser.
const ALLOWED_FILE_TYPES = {
  'image/jpeg': { mediaType: 'image', extensions: ['.jpg', '.jpeg'] },
  'image/png': { mediaType: 'image', extensions: ['.png'] },
  'application/pdf': { mediaType: 'document', extensions: ['.pdf'] },
};

// Upload limits: the size of one file (MAX_FILE_SIZE_MB in .env overrides the
// default) and how many files one multiple-upload request may carry
const DEFAULT_MAX_FILE_SIZE_MB = 5;
const MAX_FILES_PER_REQUEST = 10;

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
  CATEGORIES,
  DEFAULT_CATEGORY,
  SORT_FIELDS,
  ALLOWED_FILE_TYPES,
  DEFAULT_MAX_FILE_SIZE_MB,
  MAX_FILES_PER_REQUEST,
  SORT_ORDERS,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_BULK,
};
