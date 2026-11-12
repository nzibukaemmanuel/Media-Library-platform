const fs = require('node:fs/promises');
const path = require('node:path');

// Folder where uploaded files live. Configurable with UPLOAD_DIR in .env;
// relative paths resolve from the folder the app is started in.
const getUploadDir = () => path.resolve(process.env.UPLOAD_DIR || 'uploads');

// True only if filePath is located inside the upload folder. This stops a
// bad or tampered database value such as "../../server.js" or "C:/Windows/x"
// from ever being deleted.
const isInsideUploadDir = (filePath) => {
  const relative = path.relative(getUploadDir(), path.resolve(filePath));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

// Delete one stored file. Never throws; returns what happened:
//   { deleted: true }                      the file was removed
//   { deleted: false, reason: 'missing' }  it was already gone (not an error)
//   { deleted: false, reason: 'outside-upload-dir' }  refused for safety
//   { deleted: false, reason: 'error', message }      the OS refused
const deleteFile = async (filePath) => {
  if (!filePath) return { deleted: false, reason: 'missing' };

  if (!isInsideUploadDir(filePath)) {
    console.error(`Refusing to delete file outside the upload folder: ${filePath}`);
    return { deleted: false, reason: 'outside-upload-dir' };
  }

  try {
    await fs.unlink(filePath);
    return { deleted: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { deleted: false, reason: 'missing' };
    console.error(`Could not delete file ${filePath}: ${error.message}`);
    return { deleted: false, reason: 'error', message: error.message };
  }
};

module.exports = {
  getUploadDir,
  isInsideUploadDir,
  deleteFile,
};
