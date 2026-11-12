const Joi = require('joi');

const {
  MEDIA_TYPES,
  CATEGORIES,
  SORT_FIELDS,
  SORT_ORDERS,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_LIMIT,
  MAX_BULK,
} = require('../config/constants');

// Joi schemas describing every media request. They only define the rules;
// the validation middleware applies them. Objects reject unknown keys, so a
// client sending e.g. "file_path" or a misspelled filter gets a clear error
// instead of having it silently ignored.
//
// Values arrive as strings from multipart forms and query strings, so Joi's
// default conversion (e.g. "640" -> 640, "true" -> true) is relied upon.

// ---------- reusable building blocks ----------

const id = Joi.number().integer().positive().required().label('id');

// Tags may be sent as "a, b" (form field / query string) or as ["a", "b"].
//
// A comma-separated string is checked tag by tag, the same way the service
// reads it (trimmed, lower-cased, duplicates and blanks dropped), so too many
// tags or one that is too long is reported against the "tags" field like any
// other validation error, instead of only failing later in the service.
const checkTagString = (value, helpers) => {
  const tags = [...new Set(value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (tags.length > MAX_TAGS) return helpers.message(`tags can contain at most ${MAX_TAGS} tags`);
  if (tags.some((t) => t.length > MAX_TAG_LENGTH)) {
    return helpers.message(`each tag must be at most ${MAX_TAG_LENGTH} characters`);
  }
  return value;
};

const tagArray = Joi.array().items(Joi.string().trim().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS);

const tagList = Joi.alternatives()
  .try(Joi.string().trim().allow('').custom(checkTagString), tagArray)
  .messages({
    'alternatives.match': `tags must be a comma-separated string or an array of at most ${MAX_TAGS} tags of up to ${MAX_TAG_LENGTH} characters`,
  });

const nonEmptyTagList = Joi.alternatives()
  .try(
    Joi.string()
      .trim()
      .min(1)
      .custom(checkTagString)
      .custom((value, helpers) =>
        value.split(',').some((t) => t.trim()) ? value : helpers.message('Provide at least one tag')
      ),
    tagArray.min(1)
  )
  .required()
  .messages({
    'alternatives.match': `tags must be a non-empty comma-separated string or array of at most ${MAX_TAGS} tags of up to ${MAX_TAG_LENGTH} characters`,
  });

// A single tag name used in rename / delete operations
const singleTag = Joi.string().trim().min(1).max(MAX_TAG_LENGTH).pattern(/^[^,]+$/).messages({
  'string.pattern.base': '{{#label}} must be a single tag without commas',
});

const mediaTypeValue = Joi.string()
  .trim()
  .lowercase()
  .valid(...MEDIA_TYPES);

// ---------- descriptive metadata (shared by create / update / bulk update) ----------

// A category must be one of the known ones; case does not matter
const category = Joi.string()
  .trim()
  .lowercase()
  .valid(...CATEGORIES)
  .messages({ 'any.only': `category must be one of: ${CATEGORIES.join(', ')}` });

const metadataFields = {
  title: Joi.string().trim().min(1).max(MAX_TITLE_LENGTH),
  description: Joi.string().trim().allow('').max(MAX_DESCRIPTION_LENGTH),
  category,
  tags: tagList,
  width: Joi.number().integer().positive(),
  height: Joi.number().integer().positive(),
  duration: Joi.number().min(0).precision(2),
};

// ---------- request schemas ----------

// POST /media: the file itself is validated by the upload middleware; these
// are the form fields sent alongside it. The title is required; everything
// else is optional (category defaults to "general", tags to none).
const createMediaBody = Joi.object({
  ...metadataFields,
  title: metadataFields.title.required(),
});

// POST /media/multiple: the files themselves are validated by the upload
// middleware. Category, description and tags apply to every file; each file's
// title is its own file name, and per-file details (title, width, height,
// duration) are not accepted here.
const createMultipleBody = Joi.object({
  description: metadataFields.description,
  category,
  tags: metadataFields.tags,
});

// PATCH /media/:id: at least one field must be provided
const updateMediaBody = Joi.object(metadataFields)
  .min(1)
  .messages({ 'object.min': 'Provide at least one field to update' });

// Routes that only carry an :id
const idParams = Joi.object({ id });

// POST /media/bulk-update: { ids: [...], ...metadata }
const bulkUpdateBody = Joi.object({
  ids: Joi.array()
    .items(Joi.number().integer().positive())
    .min(1)
    .max(MAX_BULK)
    .unique()
    .required()
    .messages({
      'array.unique': 'ids must not contain duplicates',
      'array.max': `You can update at most ${MAX_BULK} assets at once`,
    }),
  ...metadataFields,
})
  .or(...Object.keys(metadataFields))
  .messages({ 'object.missing': 'Provide at least one field to update' });

// POST /media/bulk-delete: { ids: [...] }
const bulkDeleteBody = Joi.object({
  ids: Joi.array()
    .items(Joi.number().integer().positive())
    .min(1)
    .max(MAX_BULK)
    .unique()
    .required()
    .messages({
      'array.unique': 'ids must not contain duplicates',
      'array.max': `You can delete at most ${MAX_BULK} assets at once`,
    }),
});

// POST/DELETE /media/:id/tags: { tags }
const tagsBody = Joi.object({ tags: nonEmptyTagList });

// PATCH /media/tags/rename: { from, to }
const renameTagBody = Joi.object({
  from: singleTag.required(),
  to: singleTag.required(),
});

// DELETE /media/tags/:tag
const tagParams = Joi.object({ tag: singleTag.required() });

// GET /media: search, filter, sort and pagination
const listMediaFields = {
  // filters
  category,
  search: Joi.string().trim().min(1).max(MAX_TITLE_LENGTH),
  mediaType: Joi.alternatives().try(
    // "image" or "image,video"
    Joi.string()
      .trim()
      .lowercase()
      .pattern(new RegExp(`^(${MEDIA_TYPES.join('|')})(\\s*,\\s*(${MEDIA_TYPES.join('|')}))*$`)),
    Joi.array().items(mediaTypeValue).min(1)
  ).messages({
    'alternatives.match': `mediaType must be one or more of: ${MEDIA_TYPES.join(', ')}`,
    'string.pattern.base': `mediaType must be one or more of: ${MEDIA_TYPES.join(', ')}`,
    'array.includes': `mediaType must be one or more of: ${MEDIA_TYPES.join(', ')}`,
    'any.only': `mediaType must be one or more of: ${MEDIA_TYPES.join(', ')}`,
  }),
  mimeType: Joi.string().trim().lowercase().max(127).pattern(/^[\w.+-]+\/[\w.+-]+$/).messages({
    'string.pattern.base': 'mimeType must look like "image/png"',
  }),
  tag: singleTag,
  tags: nonEmptyTagList.optional(),
  anyTags: nonEmptyTagList.optional(),
  minSize: Joi.number().integer().min(0),
  // only compared with minSize when minSize is actually given
  maxSize: Joi.number()
    .integer()
    .min(0)
    .when('minSize', {
      is: Joi.exist(),
      then: Joi.number().min(Joi.ref('minSize')).messages({
        'number.min': 'maxSize cannot be less than minSize',
      }),
    }),
  createdFrom: Joi.date().iso(),
  // only compared with createdFrom when createdFrom is actually given
  createdTo: Joi.date()
    .iso()
    .when('createdFrom', {
      is: Joi.exist(),
      then: Joi.date().min(Joi.ref('createdFrom')).messages({
        'date.min': 'createdTo cannot be before createdFrom',
      }),
    }),

  // sorting
  sortBy: Joi.string().valid(...SORT_FIELDS),
  sortOrder: Joi.string().lowercase().valid(...SORT_ORDERS),

  // pagination: page + limit, or limit + offset
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(MAX_LIMIT),
  offset: Joi.number().integer().min(0),
};

// An empty value ("?search=&page=") means "not provided", the same as
// leaving the parameter out, so a UI can send blank filters safely.
const listMediaQuery = Joi.object(
  Object.fromEntries(
    Object.entries(listMediaFields).map(([key, schema]) => [key, schema.empty('')])
  )
)
  .oxor('page', 'offset')
  .messages({ 'object.oxor': 'Use either page or offset, not both' });

module.exports = {
  createMediaBody,
  createMultipleBody,
  updateMediaBody,
  idParams,
  bulkUpdateBody,
  bulkDeleteBody,
  tagsBody,
  renameTagBody,
  tagParams,
  listMediaQuery,
};
