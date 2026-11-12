const path = require('node:path');

const { ALLOWED_FILE_TYPES } = require('../config/constants');

const ALLOWED_MIME_TYPES = Object.keys(ALLOWED_FILE_TYPES);

// The kind of media a MIME type becomes ("image" or "document"), or null if
// the type is not one of the allowed ones
const detectMediaType = (mimeType = '') => ALLOWED_FILE_TYPES[mimeType.toLowerCase()]?.mediaType ?? null;

// Decide whether an uploaded file is acceptable.
//
// Only image/jpeg, image/png and application/pdf are accepted. The MIME type
// is sent by the client and can be faked, so it is not trusted on its own:
// the file name's extension must also be one of the extensions allowed for
// that type. That rejects "virus.exe" sent as image/png and "photo.png" sent
// as application/pdf.
//
// Returns { ok: true, mediaType } or { ok: false, message }.
const checkUpload = ({ originalname = '', mimetype = '' } = {}) => {
  const mime = mimetype.toLowerCase();
  const allowed = ALLOWED_FILE_TYPES[mime];
  if (!allowed) {
    return {
      ok: false,
      message: `Unsupported file type: ${mimetype || 'unknown'}. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
    };
  }

  const extension = path.extname(originalname).toLowerCase();
  // path.extname("photo.") is "." (a trailing dot is not a real extension)
  if (!extension || extension === '.') {
    return { ok: false, message: 'The file must have an extension, e.g. photo.png' };
  }
  if (!allowed.extensions.includes(extension)) {
    return {
      ok: false,
      message: `A ${extension} file is not allowed for ${mime} (allowed: ${allowed.extensions.join(', ')})`,
    };
  }

  return { ok: true, mediaType: allowed.mediaType };
};

module.exports = {
  ALLOWED_MIME_TYPES,
  detectMediaType,
  checkUpload,
};
