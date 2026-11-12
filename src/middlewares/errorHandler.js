const AppError = require('../utils/AppError');
const { sendError } = require('../utils/apiResponse');

// Centralised error handling. Every error that reaches Express (thrown in a
// handler, passed to next(), rejected in a catchAsync controller, or raised
// by a middleware such as body parsing or multer) ends up in errorHandler,
// which always answers with the same JSON shape:
//
//   { status: "error", message: "...", details: [{ field, message }] }
//
// The client only ever sees safe, intentional messages. Details of
// unexpected failures (stack traces, SQL errors) are logged on the server
// and never sent, except for the stack when NODE_ENV=development.

const isDevelopment = () => process.env.NODE_ENV === 'development';

// PostgreSQL error codes (err.code) that mean "the client sent something
// the database cannot accept" rather than "the server is broken"
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_CLIENT_ERRORS = {
  '22P02': [400, 'Invalid value in the request'], // invalid_text_representation
  '22003': [400, 'A number in the request is out of range'], // numeric_value_out_of_range
  '22001': [400, 'A value in the request is too long'], // string_data_right_truncation
  '23502': [400, 'A required value is missing'], // not_null_violation
  '23514': [400, 'A value in the request is not allowed'], // check_violation
  '23505': [409, 'This record already exists'], // unique_violation
  '23503': [409, 'This record is linked to other data'], // foreign_key_violation
};

// Errors meaning the database could not be reached or is shutting down
const DB_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now
]);
const isDbUnavailable = (err) =>
  DB_UNAVAILABLE_CODES.has(err.code) || (typeof err.code === 'string' && err.code.startsWith('08'));

// Turn any error into { statusCode, message, errors?, expected }.
// "expected" errors are the client's doing and are not logged as failures.
const normalize = (err) => {
  // Our own errors (validation, not found, bad input...)
  if (err instanceof AppError) {
    return { statusCode: err.statusCode, message: err.message, details: err.details, expected: true };
  }

  // Body parser errors: malformed JSON, body too large, unsupported charset
  if (err.type === 'entity.parse.failed') {
    return { statusCode: 400, message: 'Request body contains invalid JSON', expected: true };
  }
  if (err.type === 'entity.too.large') {
    return { statusCode: 413, message: 'Request body is too large', expected: true };
  }
  if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
    return { statusCode: 415, message: 'Unsupported request encoding', expected: true };
  }

  // Database: bad client data, or database unreachable
  if (PG_CLIENT_ERRORS[err.code]) {
    const [statusCode, message] = PG_CLIENT_ERRORS[err.code];
    return { statusCode, message, expected: true };
  }
  if (isDbUnavailable(err)) {
    return { statusCode: 503, message: 'The service is temporarily unavailable', expected: false };
  }

  // Other http-style errors that are safe to show (4xx with expose=true)
  if (err.expose === true && err.status >= 400 && err.status < 500) {
    return { statusCode: err.status, message: err.message, expected: true };
  }

  // Anything else is a bug: hide the details from the client
  return { statusCode: 500, message: 'Internal server error', expected: false };
};

// 404 for requests no route handled; hands a proper error to errorHandler
const notFound = (req, res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};

// eslint-disable-next-line no-unused-vars -- Express needs the 4-argument signature
const errorHandler = (err, req, res, next) => {
  // If the response already started we can no longer change it; let
  // Express close the connection
  if (res.headersSent) return next(err);

  const { statusCode, message, details, expected } = normalize(err ?? new Error('Unknown error'));

  // Log what the client must not see. Expected client errors stay quiet.
  if (!expected) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${statusCode}`);
    console.error(err);
  }

  return sendError(res, {
    statusCode,
    message,
    details,
    stack: isDevelopment() && !expected ? err?.stack : undefined,
  });
};

module.exports = { errorHandler, notFound };
