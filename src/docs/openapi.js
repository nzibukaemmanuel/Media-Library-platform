// The OpenAPI 3 description of the API, shown by Swagger UI at /api-docs.
//
// Enums and limits come from config/constants.js, the same place the
// validation uses, so the documentation cannot drift from what the API
// accepts. tests/swagger.test.js also checks that every route in the router
// is described here, and that the document itself is valid OpenAPI.

const {
  MEDIA_TYPES,
  CATEGORIES,
  DEFAULT_CATEGORY,
  SORT_FIELDS,
  SORT_ORDERS,
  ALLOWED_FILE_TYPES,
  DEFAULT_MAX_FILE_SIZE_MB,
  MAX_FILES_PER_REQUEST,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_BULK,
} = require('../config/constants');

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const response = (name) => ({ $ref: `#/components/responses/${name}` });

// Every success response is { status: "success", data }
const success = (data, description) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['status', 'data'],
        properties: { status: { type: 'string', enum: ['success'] }, data },
      },
    },
  },
});

const jsonBody = (schema, example) => ({
  required: true,
  content: { 'application/json': { schema, ...(example ? { example } : {}) } },
});

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'The id of the media item',
  schema: { type: 'integer', minimum: 1, example: 1 },
};

const tagsInput = {
  description: `Tags as a comma-separated string ("summer, beach") or an array. At most ${MAX_TAGS}, each up to ${MAX_TAG_LENGTH} characters; trimmed, lower-cased and de-duplicated`,
  oneOf: [{ type: 'string', example: 'summer, beach' }, { type: 'array', items: { type: 'string' }, maxItems: MAX_TAGS, example: ['summer', 'beach'] }],
};

// The metadata fields shared by upload, update and bulk update
const metadataProperties = {
  description: { type: 'string', maxLength: MAX_DESCRIPTION_LENGTH, example: 'Evening at the coast' },
  category: { $ref: '#/components/schemas/Category' },
  tags: tagsInput,
  width: { type: 'integer', minimum: 1, description: 'Pixels', example: 1920 },
  height: { type: 'integer', minimum: 1, description: 'Pixels', example: 1080 },
  duration: { type: 'number', minimum: 0, description: 'Seconds, rounded to two decimals', example: 12.5 },
};
const titleProperty = { type: 'string', minLength: 1, maxLength: MAX_TITLE_LENGTH, example: 'Beach sunset' };

const allowedTypes = Object.keys(ALLOWED_FILE_TYPES);
const fileEncoding = (field) => ({ [field]: { contentType: allowedTypes.join(', ') } });

const idsArray = {
  type: 'array',
  items: { type: 'integer', minimum: 1 },
  minItems: 1,
  maxItems: MAX_BULK,
  uniqueItems: true,
  example: [1, 2],
};

const mediaExample = {
  id: 1,
  title: 'Beach sunset',
  description: 'Evening at the coast',
  category: 'design',
  mediaType: 'image',
  fileName: '1794498277901-52555a87-9a33-4b75-83d9-6695e31b31b3.png',
  originalName: 'beach.png',
  filePath: '/srv/media-library/uploads/1794498277901-52555a87-9a33-4b75-83d9-6695e31b31b3.png',
  mimeType: 'image/png',
  fileSize: 204800,
  width: 1920,
  height: 1080,
  duration: null,
  tags: ['summer', 'beach'],
  createdAt: '2026-11-12T15:44:37.908Z',
  updatedAt: '2026-11-12T15:44:37.908Z',
};

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Media Library API',
    version: '1.0.0',
    description: [
      'Upload images and PDFs with metadata, then search, filter, sort, page through, edit and delete them.',
      '',
      '**Paths.** The endpoints are served at `/media/...`; `/api/media/...` is an alias that behaves identically.',
      '',
      '**Responses.** Every response is JSON in one of two formats:',
      '',
      '- success: `{ "status": "success", "data": ... }`',
      '- error: `{ "status": "error", "message": "...", "details": [{ "field": "...", "message": "..." }] }`',
      '',
      `**Uploads.** JPEG, PNG or PDF only, at most ${DEFAULT_MAX_FILE_SIZE_MB} MB per file (set by MAX_FILE_SIZE_MB). The file extension must agree with the type.`,
      '',
      '**Trying it out.** Use "Try it out" on any endpoint; file upload endpoints show a file chooser.',
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'This server' }],
  tags: [
    { name: 'Media', description: 'Upload, list, read, update and delete media items' },
    { name: 'Tags', description: 'Manage tags on one item or across the whole library' },
    { name: 'Bulk', description: 'Apply one change to many items' },
    { name: 'Health', description: 'Is the server running?' },
  ],

  paths: {
    '/media': {
      post: {
        tags: ['Media'],
        summary: 'Upload one file',
        description:
          `Uploads one JPEG, PNG or PDF (at most ${DEFAULT_MAX_FILE_SIZE_MB} MB) together with its metadata. ` +
          'The request is checked before anything is stored: a rejected upload leaves no file and no record behind.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file', 'title'],
                properties: {
                  file: { type: 'string', format: 'binary', description: `One file in the field "file": ${allowedTypes.join(', ')}` },
                  title: titleProperty,
                  ...metadataProperties,
                },
              },
              encoding: fileEncoding('file'),
            },
          },
        },
        responses: {
          201: success(ref('Media'), 'Created'),
          400: response('BadRequest'),
          500: response('ServerError'),
          503: response('ServiceUnavailable'),
        },
      },
      get: {
        tags: ['Media'],
        summary: 'List media (search, filter, sort, paginate)',
        description:
          'All parameters are optional and combine with AND. An empty value (`?search=`) is treated as if the parameter were not sent. ' +
          'Unknown parameters are rejected. Items with equal sort values are ordered by id, so paging never repeats or skips an item.',
        parameters: [
          { name: 'page', in: 'query', description: 'Page number, starting at 1', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', description: 'Results per page', schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT } },
          { name: 'category', in: 'query', description: 'Only items in this category', schema: { $ref: '#/components/schemas/Category' } },
          { name: 'tags', in: 'query', description: 'Items that have ALL of these comma-separated tags', schema: { type: 'string', example: 'summer,beach' } },
          {
            name: 'search',
            in: 'query',
            description:
              'Text to find in the title, description or original file name. Case-insensitive, matches part of a word; % _ and \\ match literally',
            schema: { type: 'string', maxLength: MAX_TITLE_LENGTH, example: 'sunset' },
          },
          { name: 'sortBy', in: 'query', description: 'Field to sort by', schema: { type: 'string', enum: SORT_FIELDS, default: 'createdAt' } },
          { name: 'order', in: 'query', description: 'Sort direction', schema: { type: 'string', enum: SORT_ORDERS, default: 'desc' } },
          { name: 'tag', in: 'query', description: 'Items that have this single tag', schema: { type: 'string' } },
          { name: 'anyTags', in: 'query', description: 'Items that have AT LEAST ONE of these comma-separated tags', schema: { type: 'string', example: 'summer,urban' } },
          {
            name: 'mediaType',
            in: 'query',
            description: `One or more kinds of media, comma-separated: ${MEDIA_TYPES.join(', ')}`,
            schema: { type: 'string', example: 'image,document' },
          },
          { name: 'mimeType', in: 'query', description: 'Exact MIME type', schema: { type: 'string', enum: allowedTypes } },
          { name: 'minSize', in: 'query', description: 'Smallest file size in bytes (inclusive)', schema: { type: 'integer', minimum: 0 } },
          { name: 'maxSize', in: 'query', description: 'Largest file size in bytes (inclusive)', schema: { type: 'integer', minimum: 0 } },
          { name: 'createdFrom', in: 'query', description: 'Created on or after (ISO 8601)', schema: { type: 'string', format: 'date-time' } },
          { name: 'createdTo', in: 'query', description: 'Created on or before (ISO 8601)', schema: { type: 'string', format: 'date-time' } },
          { name: 'offset', in: 'query', description: 'Items to skip, instead of `page` (do not send both)', schema: { type: 'integer', minimum: 0 } },
        ],
        responses: {
          200: success(
            {
              type: 'object',
              required: ['results', 'pagination'],
              properties: { results: { type: 'array', items: ref('Media') }, pagination: ref('Pagination') },
            },
            'A page of results. A page past the end returns an empty `results` list'
          ),
          400: response('BadRequest'),
          500: response('ServerError'),
          503: response('ServiceUnavailable'),
        },
      },
    },

    '/media/multiple': {
      post: {
        tags: ['Media'],
        summary: 'Upload several files at once',
        description:
          `Up to ${MAX_FILES_PER_REQUEST} files in the field "files". Category, description and tags apply to every file; each item's title is its file name. ` +
          '**All or nothing:** if any file is invalid, or the database refuses one, nothing is stored.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['files'],
                properties: {
                  files: {
                    type: 'array',
                    minItems: 1,
                    maxItems: MAX_FILES_PER_REQUEST,
                    items: { type: 'string', format: 'binary' },
                    description: `Repeat the field once per file: ${allowedTypes.join(', ')}`,
                  },
                  description: metadataProperties.description,
                  category: metadataProperties.category,
                  tags: metadataProperties.tags,
                },
              },
              encoding: fileEncoding('files'),
            },
          },
        },
        responses: {
          201: success(
            { type: 'object', required: ['results'], properties: { results: { type: 'array', items: ref('Media') } } },
            'Created: one item per file, in the order sent'
          ),
          400: response('BadRequest'),
          500: response('ServerError'),
          503: response('ServiceUnavailable'),
        },
      },
    },

    '/media/{id}': {
      get: {
        tags: ['Media'],
        summary: 'Get one media item',
        parameters: [idParam],
        responses: { 200: success(ref('Media'), 'The media item'), 400: response('BadRequest'), 404: response('NotFound'), 500: response('ServerError') },
      },
      put: {
        tags: ['Media'],
        summary: 'Update media metadata',
        description:
          'Changes only the fields that are sent (at least one is required). The stored file can never be replaced, so `filePath`, `mediaType`, `mimeType`, ' +
          '`fileSize` and the file names are rejected. Sending `tags` replaces the whole tag list.',
        parameters: [idParam],
        requestBody: jsonBody(ref('UpdateMedia'), { title: 'Beach at sunset', category: 'design', tags: ['summer', 'coast'] }),
        responses: { 200: success(ref('Media'), 'The updated item'), 400: response('BadRequest'), 404: response('NotFound'), 500: response('ServerError') },
      },
      patch: {
        tags: ['Media'],
        summary: 'Update media metadata (same as PUT)',
        description: 'Identical to `PUT /media/{id}`.',
        parameters: [idParam],
        requestBody: jsonBody(ref('UpdateMedia'), { description: 'Updated with PATCH' }),
        responses: { 200: success(ref('Media'), 'The updated item'), 400: response('BadRequest'), 404: response('NotFound'), 500: response('ServerError') },
      },
      delete: {
        tags: ['Media'],
        summary: 'Delete a media item and its file',
        description:
          'Removes the record, then the stored file. The record is the source of truth: if the file was already gone or could not be removed, ' +
          'the record is still deleted and `fileDeleted` is `false`. A file outside the upload folder is never deleted.',
        parameters: [idParam],
        responses: {
          200: success(
            {
              type: 'object',
              required: ['id', 'fileDeleted'],
              properties: { id: { type: 'integer', example: 1 }, fileDeleted: { type: 'boolean', example: true } },
            },
            'Deleted'
          ),
          400: response('BadRequest'),
          404: response('NotFound'),
          500: response('ServerError'),
        },
      },
    },

    '/media/tags': {
      get: {
        tags: ['Tags'],
        summary: 'List every tag with how many items use it',
        responses: {
          200: success(
            {
              type: 'array',
              items: {
                type: 'object',
                required: ['tag', 'count'],
                properties: { tag: { type: 'string', example: 'summer' }, count: { type: 'integer', example: 2 } },
              },
            },
            'Tags, most used first'
          ),
          500: response('ServerError'),
        },
      },
    },

    '/media/tags/rename': {
      patch: {
        tags: ['Tags'],
        summary: 'Rename a tag on every item',
        description: 'If an item already has the new tag, the two merge without duplicates. A tag nobody has is a 404.',
        requestBody: jsonBody(
          {
            type: 'object',
            required: ['from', 'to'],
            properties: { from: { type: 'string', example: 'coast' }, to: { type: 'string', example: 'seaside' } },
          },
          { from: 'coast', to: 'seaside' }
        ),
        responses: {
          200: success(
            {
              type: 'object',
              properties: { tag: { type: 'string', example: 'seaside' }, previousTag: { type: 'string', example: 'coast' }, changed: { type: 'integer', example: 1 } },
            },
            'How many items changed'
          ),
          400: response('BadRequest'),
          404: response('NotFound'),
          500: response('ServerError'),
        },
      },
    },

    '/media/tags/{tag}': {
      delete: {
        tags: ['Tags'],
        summary: 'Remove a tag from every item',
        parameters: [{ name: 'tag', in: 'path', required: true, description: 'A single tag, without commas', schema: { type: 'string', example: 'seaside' } }],
        responses: {
          200: success(
            { type: 'object', properties: { tag: { type: 'string', example: 'seaside' }, changed: { type: 'integer', example: 1 } } },
            'How many items changed'
          ),
          400: response('BadRequest'),
          404: response('NotFound'),
          500: response('ServerError'),
        },
      },
    },

    '/media/{id}/tags': {
      post: {
        tags: ['Tags'],
        summary: 'Add tags to one item',
        description: `Keeps the existing tags; no duplicates. An item can have at most ${MAX_TAGS} tags.`,
        parameters: [idParam],
        requestBody: jsonBody(
          { type: 'object', required: ['tags'], properties: { tags: tagsInput } },
          { tags: ['holiday'] }
        ),
        responses: { 200: success(ref('Media'), 'The updated item'), 400: response('BadRequest'), 404: response('NotFound'), 500: response('ServerError') },
      },
      delete: {
        tags: ['Tags'],
        summary: 'Remove tags from one item',
        description:
          'Tags the item does not have are ignored. This endpoint takes a JSON body; some HTTP clients drop request bodies on DELETE, ' +
          'in which case replace the tag list with `PUT /media/{id}` instead.',
        parameters: [idParam],
        requestBody: jsonBody(
          { type: 'object', required: ['tags'], properties: { tags: tagsInput } },
          { tags: ['holiday'] }
        ),
        responses: { 200: success(ref('Media'), 'The updated item'), 400: response('BadRequest'), 404: response('NotFound'), 500: response('ServerError') },
      },
    },

    '/media/bulk-update': {
      post: {
        tags: ['Bulk'],
        summary: 'Apply the same change to many items',
        description: `${MAX_BULK} items at most. Ids that do not exist do not fail the request; they are reported in \`notFound\`.`,
        requestBody: jsonBody(
          {
            type: 'object',
            required: ['ids'],
            description: 'At least one metadata field is needed besides `ids`',
            properties: { ids: idsArray, title: titleProperty, ...metadataProperties },
          },
          { ids: [1, 2], category: 'marketing' }
        ),
        responses: {
          200: success(
            {
              type: 'object',
              required: ['updated', 'notFound'],
              properties: { updated: { type: 'array', items: ref('Media') }, notFound: { type: 'array', items: { type: 'integer' }, example: [9999] } },
            },
            'The updated items, and the ids that were not found'
          ),
          400: response('BadRequest'),
          500: response('ServerError'),
        },
      },
    },

    '/media/bulk-delete': {
      post: {
        tags: ['Bulk'],
        summary: 'Delete many items and their files',
        description: `${MAX_BULK} items at most. \`filesNotDeleted\` lists items whose record was deleted but whose file could not be removed.`,
        requestBody: jsonBody({ type: 'object', required: ['ids'], properties: { ids: idsArray } }, { ids: [1, 2] }),
        responses: {
          200: success(
            {
              type: 'object',
              required: ['deleted', 'notFound', 'filesNotDeleted'],
              properties: {
                deleted: { type: 'array', items: { type: 'integer' }, example: [1] },
                notFound: { type: 'array', items: { type: 'integer' }, example: [9999] },
                filesNotDeleted: { type: 'array', items: { type: 'integer' }, example: [] },
              },
            },
            'Which ids were deleted, not found, or left a file behind'
          ),
          400: response('BadRequest'),
          500: response('ServerError'),
        },
      },
    },

    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        responses: {
          200: success(
            { type: 'object', properties: { message: { type: 'string', example: 'Server is running successfully' } } },
            'The server is running'
          ),
        },
      },
    },
  },

  components: {
    schemas: {
      Category: {
        type: 'string',
        enum: CATEGORIES,
        default: DEFAULT_CATEGORY,
        description: 'The category of a media item',
        example: 'design',
      },
      Media: {
        type: 'object',
        required: [
          'id', 'title', 'description', 'category', 'mediaType', 'fileName', 'originalName', 'filePath',
          'mimeType', 'fileSize', 'width', 'height', 'duration', 'tags', 'createdAt', 'updatedAt',
        ],
        properties: {
          id: { type: 'integer', example: mediaExample.id },
          title: { type: 'string', example: mediaExample.title },
          description: { type: 'string', nullable: true, example: mediaExample.description },
          category: { $ref: '#/components/schemas/Category' },
          mediaType: { type: 'string', enum: MEDIA_TYPES, description: 'Detected from the file: `image` (JPEG, PNG) or `document` (PDF)', example: mediaExample.mediaType },
          fileName: { type: 'string', description: 'Generated name the file is stored under', example: mediaExample.fileName },
          originalName: { type: 'string', description: 'The name the file had when it was uploaded', example: mediaExample.originalName },
          filePath: { type: 'string', description: 'Absolute path of the stored file on the server', example: mediaExample.filePath },
          mimeType: { type: 'string', enum: allowedTypes, example: mediaExample.mimeType },
          fileSize: { type: 'integer', description: 'Size in bytes', example: mediaExample.fileSize },
          width: { type: 'integer', nullable: true, example: mediaExample.width },
          height: { type: 'integer', nullable: true, example: mediaExample.height },
          duration: { type: 'number', nullable: true, description: 'Seconds', example: mediaExample.duration },
          tags: { type: 'array', items: { type: 'string' }, example: mediaExample.tags },
          createdAt: { type: 'string', format: 'date-time', example: mediaExample.createdAt },
          updatedAt: { type: 'string', format: 'date-time', example: mediaExample.updatedAt },
        },
      },
      UpdateMedia: {
        type: 'object',
        minProperties: 1,
        description: 'At least one field is required; only the fields sent are changed',
        properties: { title: titleProperty, ...metadataProperties },
      },
      Pagination: {
        type: 'object',
        required: ['total', 'page', 'limit', 'totalPages'],
        properties: {
          total: { type: 'integer', description: 'Items matching the filters, across all pages', example: 84 },
          page: { type: 'integer', example: 2 },
          limit: { type: 'integer', example: 10 },
          totalPages: { type: 'integer', example: 9 },
        },
      },
      ErrorDetail: {
        type: 'object',
        required: ['field', 'message'],
        properties: {
          field: { type: 'string', nullable: true, description: 'The field with the problem; null for a problem with the request as a whole', example: 'title' },
          message: { type: 'string', example: 'Title is required' },
        },
      },
      Error: {
        type: 'object',
        required: ['status', 'message', 'details'],
        properties: {
          status: { type: 'string', enum: ['error'] },
          message: { type: 'string', example: 'Validation failed' },
          details: { type: 'array', items: ref('ErrorDetail'), description: 'Field-level problems for a validation failure; empty for every other error' },
        },
      },
    },
    responses: {
      BadRequest: {
        description: 'The request is invalid: validation failed, or the file was rejected (type, size, empty, wrong field)',
        content: {
          'application/json': {
            schema: ref('Error'),
            examples: {
              validation: {
                summary: 'Validation failed',
                value: { status: 'error', message: 'Validation failed', details: [{ field: 'title', message: 'Title is required' }] },
              },
              fileType: {
                summary: 'Rejected file',
                value: {
                  status: 'error',
                  message: 'Unsupported file type: video/mp4. Allowed types: image/jpeg, image/png, application/pdf',
                  details: [],
                },
              },
            },
          },
        },
      },
      NotFound: {
        description: 'The item (or route) does not exist',
        content: { 'application/json': { schema: ref('Error'), example: { status: 'error', message: 'Media not found', details: [] } } },
      },
      ServerError: {
        description: 'Unexpected server error (the cause is logged, never sent)',
        content: { 'application/json': { schema: ref('Error'), example: { status: 'error', message: 'Internal server error', details: [] } } },
      },
      ServiceUnavailable: {
        description: 'The database is temporarily unavailable',
        content: {
          'application/json': { schema: ref('Error'), example: { status: 'error', message: 'The service is temporarily unavailable', details: [] } },
        },
      },
    },
  },
};

module.exports = spec;
