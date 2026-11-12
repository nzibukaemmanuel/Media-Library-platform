const express = require('express');

const mediaController = require('../controllers/mediaController');
const { uploadSingle } = require('../middlewares/upload');
const validate = require('../middlewares/validate');
const schemas = require('../validations/mediaValidation');

const router = express.Router();

// NOTE: fixed paths (/tags, /bulk-*) must be registered before /:id,
// otherwise Express would treat "tags" or "bulk-update" as an id.
//
// Every route that takes input validates it before the controller runs, so
// controllers only ever see clean, type-converted values.

// ----- Library-wide tags -----
router.get('/tags', mediaController.listTags);
router.patch(
  '/tags/rename',
  validate({ body: schemas.renameTagBody }),
  mediaController.renameTag
);
router.delete(
  '/tags/:tag',
  validate({ params: schemas.tagParams }),
  mediaController.deleteTag
);

// ----- Bulk operations -----
router.post(
  '/bulk-update',
  validate({ body: schemas.bulkUpdateBody }),
  mediaController.bulkUpdateMedia
);
router.post(
  '/bulk-delete',
  validate({ body: schemas.bulkDeleteBody }),
  mediaController.bulkDeleteMedia
);

// ----- Collection -----
router
  .route('/')
  .get(mediaController.listMedia)
  // multipart, field "file". The upload runs first, then the other form
  // fields are validated; if they are invalid the stored file is removed.
  .post(uploadSingle, validate({ body: schemas.createMediaBody }), mediaController.createMedia);

// ----- Single asset -----
router
  .route('/:id')
  .get(validate({ params: schemas.idParams }), mediaController.getMedia)
  .patch(
    validate({ params: schemas.idParams, body: schemas.updateMediaBody }),
    mediaController.updateMedia
  )
  .delete(validate({ params: schemas.idParams }), mediaController.deleteMedia);

router
  .route('/:id/tags')
  .post(
    validate({ params: schemas.idParams, body: schemas.tagsBody }),
    mediaController.addTags
  )
  .delete(
    validate({ params: schemas.idParams, body: schemas.tagsBody }),
    mediaController.removeTags
  );

module.exports = router;
