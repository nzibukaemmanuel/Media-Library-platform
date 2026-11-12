// Limits and allowed values shared by the validation schemas, the service
// and the repository, so a rule is defined in exactly one place.

// Kinds of media (must match the media_type enum in database/schema.sql)
const MEDIA_TYPES = ['image', 'video', 'audio', 'document'];

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

// File extensions accepted for each kind of media. Uploads are checked against
// this as well as the (client-supplied) MIME type. SVG, HTML and scripts are
// deliberately absent: they can carry executable code if served back.
const ALLOWED_EXTENSIONS = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif'],
  video: ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'],
  document: [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.rtf', '.txt', '.csv', '.md',
  ],
};

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
  ALLOWED_EXTENSIONS,
  SORT_ORDERS,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_BULK,
};
