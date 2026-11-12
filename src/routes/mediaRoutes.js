const express = require('express');

const mediaController = require('../controllers/mediaController');
const { uploadSingle } = require('../middlewares/upload');

const router = express.Router();

// NOTE: fixed paths (/tags, /bulk-*) must be registered before /:id,
// otherwise Express would treat "tags" or "bulk-update" as an id.

// ----- Library-wide tags -----
router.get('/tags', mediaController.listTags);
router.patch('/tags/rename', mediaController.renameTag);
router.delete('/tags/:tag', mediaController.deleteTag);

// ----- Bulk operations -----
router.post('/bulk-update', mediaController.bulkUpdateMedia);
router.post('/bulk-delete', mediaController.bulkDeleteMedia);

// ----- Collection -----
router
  .route('/')
  .get(mediaController.listMedia)
  .post(uploadSingle, mediaController.createMedia); // multipart, field "file"

// ----- Single asset -----
router
  .route('/:id')
  .get(mediaController.getMedia)
  .patch(mediaController.updateMedia)
  .delete(mediaController.deleteMedia);

router
  .route('/:id/tags')
  .post(mediaController.addTags)
  .delete(mediaController.removeTags);

module.exports = router;
