// One response envelope for the whole API, so clients can rely on the shape.
//
// Success:
//   {
//     success: true,
//     message: "Media retrieved successfully",
//     data:    <the resource, a list, or null when there is nothing to return>,
//     meta:    { ... }   // only when there is extra info, e.g. pagination
//   }
//
// Error (built by the error handler):
//   {
//     success: false,
//     message: "Why it failed",
//     errors:  [{ source, field, message }]   // only for validation errors
//   }
//
// "data" is always present on success (null if empty) and never on errors,
// so clients can branch on `success` and know exactly which keys to expect.

const sendSuccess = (res, { statusCode = 200, message = 'Success', data = null, meta } = {}) => {
  const body = { success: true, message, data };
  if (meta !== undefined) body.meta = meta;
  return res.status(statusCode).json(body);
};

const sendError = (res, { statusCode = 500, message = 'Internal server error', errors, stack } = {}) => {
  const body = { success: false, message };
  if (errors?.length) body.errors = errors;
  if (stack) body.stack = stack; // only ever set in development
  return res.status(statusCode).json(body);
};

module.exports = { sendSuccess, sendError };
