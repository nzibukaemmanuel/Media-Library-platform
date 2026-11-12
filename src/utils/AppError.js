// Error for expected, client-facing failures (bad input, not found, ...).
// The error handler can send statusCode/message to the client as-is, while
// anything that is not an AppError is treated as an unexpected 500.
//
// `details` is an optional list of field-level problems,
// [{ field, message }], returned to the client in the error response
// (used by request validation).
class AppError extends Error {
  constructor(message, statusCode = 500, details = []) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
