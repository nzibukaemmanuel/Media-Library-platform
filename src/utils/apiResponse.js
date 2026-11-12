// One response format for the whole API, so clients can rely on its shape.
//
// Success:
//   { "status": "success", "data": <the resource, a list object, or null> }
//
// Error:
//   {
//     "status": "error",
//     "message": "Validation failed",
//     "details": [{ "field": "title", "message": "Title is required" }]
//   }
//
// - `status` is always "success" or "error", so a client branches on one field.
// - `data` is always present on success (null when there is nothing to return)
//   and never present on errors.
// - `details` is always present on errors: field-level problems for validation
//   errors, an empty array for everything else.
// - Lists are { results: [...], pagination: { total, page, limit, totalPages } }.

const sendSuccess = (res, { statusCode = 200, data = null } = {}) =>
  res.status(statusCode).json({ status: 'success', data });

const sendError = (res, { statusCode = 500, message = 'Internal server error', details = [], stack } = {}) => {
  const body = { status: 'error', message, details };
  if (stack) body.stack = stack; // only ever set in development
  return res.status(statusCode).json(body);
};

module.exports = { sendSuccess, sendError };
