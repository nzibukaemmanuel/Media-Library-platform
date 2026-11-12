const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const multer = require('multer');

const AppError = require('../utils/AppError');
const { getUploadDir } = require('../utils/fileStorage');
const { checkUpload } = require('../utils/fileTypes');

// Maximum upload size, configurable with MAX_FILE_SIZE_MB (default 50)
const getMaxFileSize = () => {
  const megabytes = Number(process.env.MAX_FILE_SIZE_MB);
  const valid = Number.isFinite(megabytes) && megabytes > 0;
  // multer requires a whole number of bytes, so round down fractional MB
  return Math.max(1, Math.floor((valid ? megabytes : 50) * 1024 * 1024));
};

// Store files in the upload folder under a random name, so two uploads with
// the same original name never collide and user-supplied names never reach
// the file system. Only a sanitised extension is kept.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = getUploadDir();
    fs.mkdir(dir, { recursive: true }, (error) => cb(error, dir));
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase().replaceAll(/[^.a-z0-9]/g, '');
    cb(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

// Reject unsupported files before anything is written to disk: the MIME type
// must be a supported kind of media AND the file extension must be allowed
// for it (see utils/fileTypes.js).
const fileFilter = (req, file, cb) => {
  const check = checkUpload(file);
  if (check.ok) return cb(null, true);
  return cb(new AppError(check.message, 400));
};

// Single-file upload from the form field "file"; other form fields
// (title, description, tags, ...) end up in req.body.
const uploadSingle = (req, res, next) => {
  const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: getMaxFileSize(), files: 1 },
  }).single('file');

  upload(req, res, (error) => {
    if (!error) return next();

    // Turn multer's own errors into client errors with readable messages
    if (error instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: `File is too large (max ${Number((getMaxFileSize() / 1024 / 1024).toFixed(2))} MB)`,
        LIMIT_FILE_COUNT: 'Upload one file at a time',
        LIMIT_UNEXPECTED_FILE: 'Send the file in a form field named "file"',
      };
      return next(new AppError(messages[error.code] || error.message, 400));
    }
    return next(error);
  });
};

module.exports = { uploadSingle };
