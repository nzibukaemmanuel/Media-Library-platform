const fs = require('node:fs/promises');
const path = require('node:path');

const mediaRepository = require('../repositories/mediaRepository');
const AppError = require('../utils/AppError');

const MEDIA_TYPES = ['image', 'video', 'audio', 'document'];

// Non-"type/..." MIME types that count as documents
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf',
]);

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;
const MAX_TITLE_LENGTH = 255;

// ---------- helpers ----------

// Work out the media_type from a MIME type, or null if it is not supported
const detectMediaType = (mimeType = '') => {
  const mime = mimeType.toLowerCase();
  const prefix = mime.split('/')[0];
  if (['image', 'video', 'audio'].includes(prefix)) return prefix;
  if (prefix === 'text' || DOCUMENT_MIME_TYPES.has(mime)) return 'document';
  return null;
};

// Accept "a, b" or ["a", "b"]; trim, lowercase, drop empties and duplicates
const normalizeTags = (tags) => {
  if (tags === undefined || tags === null || tags === '') return [];
  const list = Array.isArray(tags) ? tags : String(tags).split(',');
  const cleaned = list.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  const unique = [...new Set(cleaned)];

  if (unique.length > MAX_TAGS) {
    throw new AppError(`A media asset can have at most ${MAX_TAGS} tags`, 400);
  }
  if (unique.some((t) => t.length > MAX_TAG_LENGTH)) {
    throw new AppError(`Each tag must be at most ${MAX_TAG_LENGTH} characters`, 400);
  }
  return unique;
};

const parseId = (id) => {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AppError('Media id must be a positive integer', 400);
  }
  return n;
};

// Parse an optional number; undefined/'' means "not provided"
const parseNumber = (value, field, { integer = false, min = 0, exclusiveMin = false } = {}) => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  const belowMin = exclusiveMin ? n <= min : n < min;
  if (!Number.isFinite(n) || belowMin || (integer && !Number.isInteger(n))) {
    throw new AppError(`${field} must be a valid ${integer ? 'integer' : 'number'}`, 400);
  }
  return n;
};

const parseDate = (value, field) => {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${field} must be a valid date`, 400);
  }
  return date;
};

const cleanText = (value, field, { required = false, max } = {}) => {
  if (value === undefined || value === null) {
    if (required) throw new AppError(`${field} is required`, 400);
    return undefined;
  }
  const text = String(value).trim();
  if (required && !text) throw new AppError(`${field} cannot be empty`, 400);
  if (max && text.length > max) {
    throw new AppError(`${field} must be at most ${max} characters`, 400);
  }
  return text;
};

// Delete a stored file; a missing file is fine, other failures are logged
// (the database row is the source of truth, so we do not fail the request)
const removeFile = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Could not delete file ${filePath}: ${error.message}`);
    }
  }
};

// Metadata fields a client may set when describing an asset
const parseMetadata = (body) => ({
  title: cleanText(body.title, 'title', { max: MAX_TITLE_LENGTH }),
  description: cleanText(body.description, 'description'),
  tags: body.tags === undefined ? undefined : normalizeTags(body.tags),
  width: parseNumber(body.width, 'width', { integer: true, min: 0, exclusiveMin: true }),
  height: parseNumber(body.height, 'height', { integer: true, min: 0, exclusiveMin: true }),
  duration: parseNumber(body.duration, 'duration'),
});

// Drop undefined keys so they are not written
const compact = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));

// ---------- operations ----------

// Create an asset from an uploaded file (a multer-style file object:
// { filename, originalname, path, mimetype, size }) and optional metadata.
// If anything fails, the already-stored file is removed so it is not orphaned.
const createMedia = async (file, body = {}) => {
  if (!file) throw new AppError('A file is required', 400);

  try {
    const mediaType = detectMediaType(file.mimetype);
    if (!mediaType) {
      throw new AppError(`Unsupported file type: ${file.mimetype}`, 400);
    }

    const metadata = compact(parseMetadata(body));
    const fallbackTitle = path.parse(file.originalname).name;

    return await mediaRepository.create({
      ...metadata,
      title: metadata.title || fallbackTitle,
      media_type: mediaType,
      file_name: file.filename,
      original_name: file.originalname,
      file_path: file.path,
      mime_type: file.mimetype,
      file_size: file.size,
    });
  } catch (error) {
    await removeFile(file.path);
    throw error;
  }
};

// Search/filter/sort/paginate. Takes raw query-string style input
// (everything may be a string) and validates it before hitting the database.
const listMedia = async (query = {}) => {
  const filters = {};

  if (query.mediaType !== undefined && query.mediaType !== '') {
    const types = normalizeTags(query.mediaType); // same "a,b" / array parsing
    const invalid = types.find((t) => !MEDIA_TYPES.includes(t));
    if (invalid) {
      throw new AppError(`mediaType must be one of: ${MEDIA_TYPES.join(', ')}`, 400);
    }
    filters.mediaType = types;
  }

  if (query.mimeType) filters.mimeType = String(query.mimeType).toLowerCase();
  if (query.search) filters.search = String(query.search).trim();

  if (query.tag) filters.tag = String(query.tag).trim().toLowerCase();
  if (query.tags) filters.tags = normalizeTags(query.tags);
  if (query.anyTags) filters.anyTags = normalizeTags(query.anyTags);

  filters.minSize = parseNumber(query.minSize, 'minSize');
  filters.maxSize = parseNumber(query.maxSize, 'maxSize');
  if (
    filters.minSize !== undefined &&
    filters.maxSize !== undefined &&
    filters.minSize > filters.maxSize
  ) {
    throw new AppError('minSize cannot be greater than maxSize', 400);
  }

  filters.createdFrom = parseDate(query.createdFrom, 'createdFrom');
  filters.createdTo = parseDate(query.createdTo, 'createdTo');
  if (filters.createdFrom && filters.createdTo && filters.createdFrom > filters.createdTo) {
    throw new AppError('createdFrom cannot be after createdTo', 400);
  }

  // Sorting and paging are sanitised again by the repository
  Object.assign(filters, {
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    page: query.page,
    limit: query.limit,
    offset: query.offset,
  });

  return mediaRepository.findAll(compact(filters));
};

const getMedia = async (id) => {
  const media = await mediaRepository.findById(parseId(id));
  if (!media) throw new AppError('Media not found', 404);
  return media;
};

// Update descriptive metadata only. The stored file and its technical
// fields (type, MIME type, size, path) cannot be changed here.
const updateMedia = async (id, body = {}) => {
  const mediaId = parseId(id);
  const changes = compact(parseMetadata(body));

  if ('title' in changes && !changes.title) {
    throw new AppError('title cannot be empty', 400);
  }
  if (Object.keys(changes).length === 0) {
    throw new AppError('Provide at least one field to update', 400);
  }

  const media = await mediaRepository.update(mediaId, changes);
  if (!media) throw new AppError('Media not found', 404);
  return media;
};

// Delete the record, then its file on disk. Returns the deleted record.
const deleteMedia = async (id) => {
  const media = await mediaRepository.remove(parseId(id));
  if (!media) throw new AppError('Media not found', 404);
  await removeFile(media.file_path);
  return media;
};

const listTags = () => mediaRepository.getTags();

module.exports = {
  createMedia,
  listMedia,
  getMedia,
  updateMedia,
  deleteMedia,
  listTags,
};
