const mediaService = require('../services/mediaService');
const catchAsync = require('../utils/catchAsync');
const { sendSuccess } = require('../utils/apiResponse');

// Controllers only translate HTTP <-> service calls: read the request,
// call the service, send a response in the standard format (see
// utils/apiResponse.js). Validation and business rules live in the service,
// which throws AppError for the error handler.

// POST /media  (multipart; the file is attached to req.file by upload middleware)
const createMedia = catchAsync(async (req, res) => {
  const media = await mediaService.createMedia(req.file, req.body);
  sendSuccess(res, { statusCode: 201, data: media });
});

// POST /media/multiple  (multipart; the files are attached to req.files)
const createMultipleMedia = catchAsync(async (req, res) => {
  const results = await mediaService.createManyMedia(req.files, req.body);
  sendSuccess(res, { statusCode: 201, data: { results } });
});

// GET /media?search=&category=&tags=&sortBy=&order=&page=&limit= ...
const listMedia = catchAsync(async (req, res) => {
  const { items, pagination } = await mediaService.listMedia(req.query);
  sendSuccess(res, {
    data: {
      results: items,
      pagination: {
        total: pagination.total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: pagination.totalPages,
      },
    },
  });
});

// GET /media/:id
const getMedia = catchAsync(async (req, res) => {
  const media = await mediaService.getMedia(req.params.id);
  sendSuccess(res, { data: media });
});

// PUT or PATCH /media/:id
const updateMedia = catchAsync(async (req, res) => {
  const media = await mediaService.updateMedia(req.params.id, req.body);
  sendSuccess(res, { data: media });
});

// DELETE /media/:id
// fileDeleted is false when the record was removed but its file could not be
// (already gone, or not removable); the record is the source of truth.
const deleteMedia = catchAsync(async (req, res) => {
  const { media, fileDeleted } = await mediaService.deleteMedia(req.params.id);
  sendSuccess(res, { data: { id: media.id, fileDeleted } });
});

// POST /media/bulk-update   body: { ids: [1, 2], title?, description?, category?, tags?, ... }
const bulkUpdateMedia = catchAsync(async (req, res) => {
  const { ids, ...changes } = req.body ?? {};
  const result = await mediaService.bulkUpdateMedia(ids, changes);
  sendSuccess(res, { data: result });
});

// POST /media/bulk-delete   body: { ids: [1, 2] }
const bulkDeleteMedia = catchAsync(async (req, res) => {
  const result = await mediaService.bulkDeleteMedia(req.body?.ids);
  sendSuccess(res, {
    data: {
      deleted: result.deleted.map((media) => media.id),
      notFound: result.notFound,
      filesNotDeleted: result.filesNotDeleted,
    },
  });
});

// GET /media/tags
const listTags = catchAsync(async (req, res) => {
  const tags = await mediaService.listTags();
  sendSuccess(res, { data: tags });
});

// POST /media/:id/tags   body: { tags: ["a", "b"] }
const addTags = catchAsync(async (req, res) => {
  const media = await mediaService.addTags(req.params.id, req.body?.tags);
  sendSuccess(res, { data: media });
});

// DELETE /media/:id/tags   body: { tags: ["a", "b"] }
const removeTags = catchAsync(async (req, res) => {
  const media = await mediaService.removeTags(req.params.id, req.body?.tags);
  sendSuccess(res, { data: media });
});

// PATCH /media/tags/rename   body: { from: "old", to: "new" }
const renameTag = catchAsync(async (req, res) => {
  const result = await mediaService.renameTag(req.body?.from, req.body?.to);
  sendSuccess(res, { data: result });
});

// DELETE /media/tags/:tag
const deleteTag = catchAsync(async (req, res) => {
  const result = await mediaService.deleteTag(req.params.tag);
  sendSuccess(res, { data: result });
});

module.exports = {
  createMedia,
  createMultipleMedia,
  listMedia,
  getMedia,
  updateMedia,
  deleteMedia,
  bulkUpdateMedia,
  bulkDeleteMedia,
  listTags,
  addTags,
  removeTags,
  renameTag,
  deleteTag,
};
