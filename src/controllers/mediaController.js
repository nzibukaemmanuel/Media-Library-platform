const mediaService = require('../services/mediaService');
const catchAsync = require('../utils/catchAsync');

// Controllers only translate HTTP <-> service calls: read the request,
// call the service, send a JSON response. Validation and business rules
// live in the service, which throws AppError for the error handler.

// POST /media  (multipart; the file is attached to req.file by upload middleware)
const createMedia = catchAsync(async (req, res) => {
  const media = await mediaService.createMedia(req.file, req.body);
  res.status(201).json({
    success: true,
    message: 'Media uploaded successfully',
    data: media,
  });
});

// GET /media?search=&mediaType=&tags=&sortBy=&page=&limit= ...
const listMedia = catchAsync(async (req, res) => {
  const { items, total, pagination } = await mediaService.listMedia(req.query);
  res.status(200).json({
    success: true,
    count: items.length,
    total,
    pagination,
    data: items,
  });
});

// GET /media/:id
const getMedia = catchAsync(async (req, res) => {
  const media = await mediaService.getMedia(req.params.id);
  res.status(200).json({ success: true, data: media });
});

// PATCH /media/:id
const updateMedia = catchAsync(async (req, res) => {
  const media = await mediaService.updateMedia(req.params.id, req.body);
  res.status(200).json({
    success: true,
    message: 'Media updated successfully',
    data: media,
  });
});

// DELETE /media/:id
const deleteMedia = catchAsync(async (req, res) => {
  const { media, fileDeleted } = await mediaService.deleteMedia(req.params.id);
  res.status(200).json({
    success: true,
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
  res.status(200).json({
    success: true,
    message: `${result.updated.length} media item(s) updated`,
    data: result,
  });
});

// POST /media/bulk-delete   body: { ids: [1, 2] }
const bulkDeleteMedia = catchAsync(async (req, res) => {
  const result = await mediaService.bulkDeleteMedia(req.body?.ids);
  res.status(200).json({
    success: true,
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
  res.status(200).json({ success: true, count: tags.length, data: tags });
});

// POST /media/:id/tags   body: { tags: ["a", "b"] }
const addTags = catchAsync(async (req, res) => {
  const media = await mediaService.addTags(req.params.id, req.body?.tags);
  res.status(200).json({
    success: true,
    message: 'Tags added successfully',
    data: media,
  });
});

// DELETE /media/:id/tags   body: { tags: ["a", "b"] }
const removeTags = catchAsync(async (req, res) => {
  const media = await mediaService.removeTags(req.params.id, req.body?.tags);
  res.status(200).json({
    success: true,
    message: 'Tags removed successfully',
    data: media,
  });
});

// PATCH /media/tags/rename   body: { from: "old", to: "new" }
const renameTag = catchAsync(async (req, res) => {
  const result = await mediaService.renameTag(req.body?.from, req.body?.to);
  res.status(200).json({
    success: true,
    message: `Tag renamed on ${result.changed} media item(s)`,
    data: result,
  });
});

// DELETE /media/tags/:tag
const deleteTag = catchAsync(async (req, res) => {
  const result = await mediaService.deleteTag(req.params.tag);
  res.status(200).json({
    success: true,
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
