const AppError = require('../utils/AppError');
const { deleteFile } = require('../utils/fileStorage');

// Joi options used for every request:
// - abortEarly: false   report all problems at once, not just the first
// - convert: true       "640" -> 640 (multipart forms and query strings are text)
// - stripUnknown: false unknown keys are errors (the schemas reject them)
// - label wrapping off  messages read `title is required`, not `"title" is required`
const JOI_OPTIONS = {
  abortEarly: false,
  convert: true,
  stripUnknown: false,
  errors: { wrap: { label: false } },
};

// Which part of the request each schema key validates
const SOURCES = ['params', 'query', 'body'];

// Express 5 exposes req.query as a read-only getter, so it cannot simply be
// reassigned. Define it as an own property to replace it with the validated,
// type-converted values; params and body are plain assignable properties.
const replace = (req, source, value) => {
  if (source === 'query') {
    Object.defineProperty(req, 'query', {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } else {
    req[source] = value;
  }
};

// Build one flat, readable error from the Joi details of every source
const toAppError = (details) => {
  const errors = details.map(({ source, error }) => ({
    source, // "params" | "query" | "body"
    field: error.path.join('.') || null,
    message: error.message,
  }));
  const appError = new AppError(errors.map((e) => e.message).join('; '), 400);
  appError.errors = errors; // lets the error handler return per-field details
  return appError;
};

// Reusable request validation middleware.
//
//   validate({ params: idParams, body: updateMediaBody })
//
// Each given schema validates the matching part of the request. On success
// req.params / req.query / req.body are replaced with the validated values
// (converted to the right types, trimmed, lowercased...), so later handlers
// can trust them. On failure the request stops with a 400 AppError that
// lists every problem.
//
// If an upload middleware already stored a file (req.file) and validation
// then fails, that file is deleted so rejected requests leave nothing
// behind on disk.
const validate = (schemas = {}) => {
  const active = SOURCES.filter((source) => schemas[source]);

  return async (req, res, next) => {
    const validated = {};
    const failures = [];

    for (const source of active) {
      // Express 5 leaves req.body undefined when no body was sent
      const input = req[source] ?? {};
      const { error, value } = schemas[source].validate(input, JOI_OPTIONS);

      if (error) {
        failures.push(...error.details.map((detail) => ({ source, error: detail })));
      } else {
        validated[source] = value;
      }
    }

    if (failures.length > 0) {
      if (req.file) await deleteFile(req.file.path);
      return next(toAppError(failures));
    }

    for (const source of active) replace(req, source, validated[source]);
    return next();
  };
};

module.exports = validate;
