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

// "title is required" -> "Title is required"
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// Build the 400 error for a failed validation: the message is always
// "Validation failed" and every problem, from every part of the request,
// is listed in details as { field, message }. field is null for a problem
// with the request as a whole (e.g. sending both page and offset).
const toAppError = (failures) => {
  const details = failures.map(({ error }) => ({
    field: error.path.join('.') || null,
    message: capitalize(error.message),
  }));
  return new AppError('Validation failed', 400, details);
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
// If an upload middleware already stored files (req.file for one, req.files
// for several) and validation then fails, those files are deleted so rejected
// requests leave nothing behind on disk.
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
      const stored = [req.file, ...(Array.isArray(req.files) ? req.files : [])].filter(Boolean);
      await Promise.all(stored.map((file) => deleteFile(file.path)));
      return next(toAppError(failures));
    }

    for (const source of active) replace(req, source, validated[source]);
    return next();
  };
};

module.exports = validate;
