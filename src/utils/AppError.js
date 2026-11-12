// Error for expected, client-facing failures (bad input, not found, ...).
// The error handler can send statusCode/message to the client as-is, while
// anything that is not an AppError is treated as an unexpected 500.
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
