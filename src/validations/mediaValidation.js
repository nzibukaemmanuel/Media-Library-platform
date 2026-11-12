const Joi = require('joi');

const {
  MEDIA_TYPES,
  SORTABLE_COLUMNS,
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

// Tags may be sent as "a, b" (form field / query string) or as ["a", "b"]
const tagList = Joi.alternatives()
  .try(
    Joi.string().trim().max(MAX_TAGS * (MAX_TAG_LENGTH + 2)).allow(''),
    Joi.array().items(Joi.string().trim().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS)
  )
  .messages({
    'alternatives.match': `tags must be a comma-separated string or an array of at most ${MAX_TAGS} tags of up to ${MAX_TAG_LENGTH} characters`,
  });

const nonEmptyTagList = Joi.alternatives()
  .try(
    Joi.string().trim().min(1).max(MAX_TAGS * (MAX_TAG_LENGTH + 2)),
    Joi.array().items(Joi.string().trim().min(1).max(MAX_TAG_LENGTH)).min(1).max(MAX_TAGS)
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

const metadataFields = {
  title: Joi.string().trim().min(1).max(MAX_TITLE_LENGTH),
  description: Joi.string().trim().allow('').max(MAX_DESCRIPTION_LENGTH),
  tags: tagList,
  width: Joi.number().integer().positive(),
  height: Joi.number().integer().positive(),
  duration: Joi.number().min(0).precision(2),
};

// ---------- request schemas ----------

// POST /media: the file itself is validated by the upload middleware; these
// are the optional form fields sent alongside it.
const createMediaBody = Joi.object(metadataFields);

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
const listMediaQuery = Joi.object({
  // filters
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
  }),
  mimeType: Joi.string().trim().lowercase().max(127).pattern(/^[\w.+-]+\/[\w.+-]+$/).messages({
    'string.pattern.base': 'mimeType must look like "image/png"',
  }),
  tag: singleTag,
  tags: nonEmptyTagList.optional(),
  anyTags: nonEmptyTagList.optional(),
  minSize: Joi.number().integer().min(0),
  maxSize: Joi.number().integer().min(0).min(Joi.ref('minSize')).messages({
    'number.min': 'maxSize cannot be less than minSize',
  }),
  createdFrom: Joi.date().iso(),
  createdTo: Joi.date().iso().min(Joi.ref('createdFrom')).messages({
    'date.min': 'createdTo cannot be before createdFrom',
  }),

  // sorting
  sortBy: Joi.string().valid(...SORTABLE_COLUMNS),
  sortOrder: Joi.string().lowercase().valid(...SORT_ORDERS),

  // pagination: page + limit, or limit + offset
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(MAX_LIMIT),
  offset: Joi.number().integer().min(0),
}).oxor('page', 'offset');

module.exports = {
  createMediaBody,
  updateMediaBody,
  idParams,
  bulkUpdateBody,
  bulkDeleteBody,
  tagsBody,
  renameTagBody,
  tagParams,
  listMediaQuery,
};
