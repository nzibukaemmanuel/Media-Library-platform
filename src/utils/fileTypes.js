const path = require('node:path');

const { ALLOWED_EXTENSIONS } = require('../config/constants');

// MIME types that count as documents but do not start with "text/"
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf',
]);

// Work out the media_type from a MIME type, or null if it is not supported
const detectMediaType = (mimeType = '') => {
  const mime = mimeType.toLowerCase();
  const prefix = mime.split('/')[0];
  if (['image', 'video', 'audio'].includes(prefix)) return prefix;
  if (prefix === 'text' || DOCUMENT_MIME_TYPES.has(mime)) return 'document';
  return null;
};

// Decide whether an uploaded file is acceptable.
//
// The MIME type is sent by the client and can be faked, so it is not trusted
// on its own: the file name's extension must also be on the allow-list for
// the detected type. That rejects "virus.exe" sent as image/png, and files
// such as .html or .js sent as text/*, which would be dangerous to serve back.
//
// Returns { ok: true, mediaType } or { ok: false, message }.
const checkUpload = ({ originalname = '', mimetype = '' } = {}) => {
  const mediaType = detectMediaType(mimetype);
  if (!mediaType) {
    return { ok: false, message: `Unsupported file type: ${mimetype || 'unknown'}` };
  }

  const extension = path.extname(originalname).toLowerCase();
  // path.extname("photo.") is "." (a trailing dot is not a real extension)
  if (!extension || extension === '.') {
    return { ok: false, message: 'The file must have an extension, e.g. photo.png' };
  }
  if (!ALLOWED_EXTENSIONS[mediaType].includes(extension)) {
    return {
      ok: false,
      message: `A ${extension} file is not allowed as ${mediaType} media (allowed: ${ALLOWED_EXTENSIONS[mediaType].join(', ')})`,
    };
  }

  return { ok: true, mediaType };
};

module.exports = {
  detectMediaType,
  checkUpload,
};
