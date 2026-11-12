const mediaService = require('../services/mediaService');
const catchAsync = require('../utils/catchAsync');
const { sendSuccess } = require('../utils/apiResponse');

// Controllers only translate HTTP <-> service calls: read the request,
// call the service, send a response in the standard envelope (see
// utils/apiResponse.js). Validation and business rules live in the service,
// which throws AppError for the error handler.

// POST /media  (multipart; the file is attached to req.file by upload middleware)
const createMedia = catchAsync(async (req, res) => {
  const media = await mediaService.createMedia(req.file, req.body);
  sendSuccess(res, {
    statusCode: 201,
    message: 'Media uploaded successfully',
    data: media,
  });
});

// GET /media?search=&mediaType=&tags=&sortBy=&page=&limit= ...
const listMedia = catchAsync(async (req, res) => {
  const { items, pagination } = await mediaService.listMedia(req.query);
  sendSuccess(res, {
    message: 'Media retrieved successfully',
    data: items,
    meta: { count: items.length, pagination },
  });
});

// GET /media/:id
const getMedia = catchAsync(async (req, res) => {
  const media = await mediaService.getMedia(req.params.id);
  sendSuccess(res, { message: 'Media retrieved successfully', data: media });
});

// PATCH /media/:id
const updateMedia = catchAsync(async (req, res) => {
  const media = await mediaService.updateMedia(req.params.id, req.body);
  sendSuccess(res, { message: 'Media updated successfully', data: media });
});

// DELETE /media/:id
const deleteMedia = catchAsync(async (req, res) => {
  const { media, fileDeleted } = await mediaService.deleteMedia(req.params.id);
  sendSuccess(res, {
    message: fileDeleted
      ? 'Media deleted successfully'
      : 'Media record deleted, but its file could not be removed from storage',
    data: { id: media.id, fileDeleted },
  });
});

// POST /media/bulk-update   body: { ids: [1, 2], title?, description?, tags?, ... }
const bulkUpdateMedia = catchAsync(async (req, res) => {
  const { ids, ...changes } = req.body ?? {};
  const result = await mediaService.bulkUpdateMedia(ids, changes);
  sendSuccess(res, {
    message: `${result.updated.length} media item(s) updated`,
    data: result,
  });
});

// POST /media/bulk-delete   body: { ids: [1, 2] }
const bulkDeleteMedia = catchAsync(async (req, res) => {
  const result = await mediaService.bulkDeleteMedia(req.body?.ids);
  sendSuccess(res, {
    message: `${result.deleted.length} media item(s) deleted`,
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
  sendSuccess(res, {
    message: 'Tags retrieved successfully',
    data: tags,
    meta: { count: tags.length },
  });
});

// POST /media/:id/tags   body: { tags: ["a", "b"] }
const addTags = catchAsync(async (req, res) => {
  const media = await mediaService.addTags(req.params.id, req.body?.tags);
  sendSuccess(res, { message: 'Tags added successfully', data: media });
});

// DELETE /media/:id/tags   body: { tags: ["a", "b"] }
const removeTags = catchAsync(async (req, res) => {
  const media = await mediaService.removeTags(req.params.id, req.body?.tags);
  sendSuccess(res, { message: 'Tags removed successfully', data: media });
});

// PATCH /media/tags/rename   body: { from: "old", to: "new" }
const renameTag = catchAsync(async (req, res) => {
  const result = await mediaService.renameTag(req.body?.from, req.body?.to);
  sendSuccess(res, {
    message: `Tag renamed on ${result.changed} media item(s)`,
    data: result,
  });
});

// DELETE /media/tags/:tag
const deleteTag = catchAsync(async (req, res) => {
  const result = await mediaService.deleteTag(req.params.tag);
  sendSuccess(res, {
    message: `Tag removed from ${result.changed} media item(s)`,
    data: result,
  });
});

module.exports = {
  createMedia,
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
