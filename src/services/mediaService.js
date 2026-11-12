const path = require('node:path');

const mediaRepository = require('../repositories/mediaRepository');
const AppError = require('../utils/AppError');
const { deleteFile } = require('../utils/fileStorage');
const { checkUpload } = require('../utils/fileTypes');
const {
  MEDIA_TYPES,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_BULK,
} = require('../config/constants');

// ---------- helpers ----------

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
    // The upload middleware already checks this; repeat it here so the
    // service is safe no matter who calls it
    const check = checkUpload(file);
    if (!check.ok) throw new AppError(check.message, 400);
    // A zero-byte "media file" is always a mistake (a failed export, an
    // interrupted copy); better to say so than to store an unusable record
    if (!file.size) throw new AppError('The uploaded file is empty', 400);
    const mediaType = check.mediaType;

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
    await deleteFile(file.path);
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

// Delete the record first, then its file on disk. The database row is the
// source of truth, so a file that cannot be removed (already gone, locked,
// or outside the upload folder) never fails the request; it is logged and
// reported as fileDeleted: false instead. Returns { media, fileDeleted }.
const deleteMedia = async (id) => {
  const media = await mediaRepository.remove(parseId(id));
  if (!media) throw new AppError('Media not found', 404);
  const result = await deleteFile(media.file_path);
  return { media, fileDeleted: result.deleted };
};

// Delete up to MAX_BULK assets and their files.
// Returns { deleted: [records], notFound: [ids], filesNotDeleted: [ids] }
// where filesNotDeleted lists assets whose record was removed but whose
// file could not be (so it can be cleaned up manually).
const bulkDeleteMedia = async (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError('Provide a non-empty array of media ids', 400);
  }
  if (ids.length > MAX_BULK) {
    throw new AppError(`You can delete at most ${MAX_BULK} assets at once`, 400);
  }
  const mediaIds = [...new Set(ids.map(parseId))];

  const deleted = await mediaRepository.removeMany(mediaIds);

  const results = await Promise.all(deleted.map((media) => deleteFile(media.file_path)));
  const filesNotDeleted = deleted
    .filter((_, index) => !results[index].deleted)
    .map((media) => media.id);

  const found = new Set(deleted.map((m) => m.id));
  return {
    deleted,
    notFound: mediaIds.filter((id) => !found.has(id)),
    filesNotDeleted,
  };
};

const listTags = () => mediaRepository.getTags();

// ---------- metadata management ----------

// Parse a non-empty list of tags from input that must contain at least one
const requireTags = (tags) => {
  const list = normalizeTags(tags);
  if (list.length === 0) throw new AppError('Provide at least one tag', 400);
  return list;
};

// Add tags to one asset, keeping existing ones (no duplicates).
const addTags = async (id, tags) => {
  const toAdd = requireTags(tags);
  const media = await getMedia(id);
  const merged = [...new Set([...media.tags, ...toAdd])];
  if (merged.length > MAX_TAGS) {
    throw new AppError(`A media asset can have at most ${MAX_TAGS} tags`, 400);
  }
  return updateMedia(media.id, { tags: merged });
};

// Remove tags from one asset; tags it does not have are ignored.
const removeTags = async (id, tags) => {
  const toRemove = new Set(requireTags(tags));
  const media = await getMedia(id);
  const remaining = media.tags.filter((t) => !toRemove.has(t));
  return updateMedia(media.id, { tags: remaining });
};

// Apply the same title/description/tags/dimensions change to many assets.
// ids must all be positive integers; assets that do not exist are reported
// in `notFound` instead of failing the whole batch.
const bulkUpdateMedia = async (ids, body = {}) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError('Provide a non-empty array of media ids', 400);
  }
  if (ids.length > MAX_BULK) {
    throw new AppError(`You can update at most ${MAX_BULK} assets at once`, 400);
  }
  const mediaIds = [...new Set(ids.map(parseId))];

  const changes = compact(parseMetadata(body));
  if ('title' in changes && !changes.title) {
    throw new AppError('title cannot be empty', 400);
  }
  if (Object.keys(changes).length === 0) {
    throw new AppError('Provide at least one field to update', 400);
  }

  const updated = await mediaRepository.updateMany(mediaIds, changes);
  const found = new Set(updated.map((m) => m.id));
  return {
    updated,
    notFound: mediaIds.filter((id) => !found.has(id)),
  };
};

// Rename a tag across the whole library. Returns how many assets changed.
const renameTag = async (oldTag, newTag) => {
  const [from] = requireTags(oldTag);
  const [to] = requireTags(newTag);
  if (from === to) throw new AppError('The new tag name must be different', 400);
  const changed = await mediaRepository.renameTag(from, to);
  if (changed === 0) throw new AppError(`Tag "${from}" not found`, 404);
  return { tag: to, previousTag: from, changed };
};

// Remove a tag from every asset that uses it. Returns how many changed.
const deleteTag = async (tag) => {
  const [name] = requireTags(tag);
  const changed = await mediaRepository.deleteTag(name);
  if (changed === 0) throw new AppError(`Tag "${name}" not found`, 404);
  return { tag: name, changed };
};

module.exports = {
  createMedia,
  listMedia,
  getMedia,
  updateMedia,
  deleteMedia,
  bulkDeleteMedia,
  listTags,
  addTags,
  removeTags,
  bulkUpdateMedia,
  renameTag,
  deleteTag,
};
