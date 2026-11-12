const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');

const multer = require('multer');

const AppError = require('../utils/AppError');
const { getUploadDir } = require('../utils/fileStorage');
const { checkUpload } = require('../utils/fileTypes');
const { DEFAULT_MAX_FILE_SIZE_MB, MAX_FILES_PER_REQUEST } = require('../config/constants');

// Maximum size of one uploaded file, configurable with MAX_FILE_SIZE_MB
// (default 5 MB). Read on every request so a change takes effect immediately.
const getMaxFileSize = () => {
  const megabytes = Number(process.env.MAX_FILE_SIZE_MB);
  const valid = Number.isFinite(megabytes) && megabytes > 0;
  // multer requires a whole number of bytes, so round down fractional MB
  return Math.max(1, Math.floor((valid ? megabytes : DEFAULT_MAX_FILE_SIZE_MB) * 1024 * 1024));
};

// Store files in the upload folder under a random name, so two uploads with
// the same original name never collide and user-supplied names never reach
// the file system. Only a sanitised extension is kept.
const storage = multer.diskStorage({
  // multer's storage API is callback based, so the result goes to cb; the
  // body itself uses async/await like the rest of the code base
  destination: async (req, file, cb) => {
    try {
      const dir = getUploadDir();
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase().replaceAll(/[^.a-z0-9]/g, '');
    cb(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

// Reject unsupported files before anything is written to disk: the MIME type
// must be one of the allowed ones (JPEG, PNG, PDF) AND the file extension must
// agree with it (see utils/fileTypes.js).
const fileFilter = (req, file, cb) => {
  const check = checkUpload(file);
  if (check.ok) return cb(null, true);
  return cb(new AppError(check.message, 400));
};

// Turn multer's own errors into client errors with readable messages
const multerMessage = (error, { field, multiple }) => {
  const maxMb = Number((getMaxFileSize() / 1024 / 1024).toFixed(2));
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return `File is too large (max ${maxMb} MB)`;
    case 'LIMIT_FILE_COUNT':
      return multiple ? `Upload at most ${MAX_FILES_PER_REQUEST} files at once` : 'Upload one file at a time';
    case 'LIMIT_UNEXPECTED_FILE': {
      // multer raises this both for a wrongly named field and for more files
      // than the field allows
      const tooMany = multiple && error.field === field;
      if (tooMany) return `Upload at most ${MAX_FILES_PER_REQUEST} files at once`;
      const noun = multiple ? 'files' : 'file';
      return `Send the ${noun} in a form field named "${field}"`;
    }
    default:
      return error.message;
  }
};

// Build the upload middleware for one form field.
// Other form fields (title, description, category, tags...) end up in req.body.
const buildUpload = ({ field, multiple }) => (req, res, next) => {
  const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: getMaxFileSize(), files: multiple ? MAX_FILES_PER_REQUEST : 1 },
    // Browsers send file names as UTF-8; multer's default (latin1) would turn
    // "写真.png" or "Zażółć.png" into garbage like "å†™çœŸ.png"
    defParamCharset: 'utf8',
  });
  const handler = multiple ? upload.array(field, MAX_FILES_PER_REQUEST) : upload.single(field);

  handler(req, res, (error) => {
    if (!error) {
      // Report missing files before the other fields are validated: it is the
      // more fundamental problem, and "title is required" would be misleading
      if (multiple && !req.files?.length) return next(new AppError('At least one file is required', 400));
      if (!multiple && !req.file) return next(new AppError('A file is required', 400));
      return next();
    }

    if (error instanceof multer.MulterError) {
      return next(new AppError(multerMessage(error, { field, multiple }), 400));
    }
    return next(error);
  });
};

// One file, from the form field "file"
const uploadSingle = buildUpload({ field: 'file', multiple: false });

// Up to MAX_FILES_PER_REQUEST files, from the form field "files"
const uploadMultiple = buildUpload({ field: 'files', multiple: true });

module.exports = { uploadSingle, uploadMultiple };
