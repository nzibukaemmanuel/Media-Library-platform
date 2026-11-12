const { getErrorMessage } = require('./errorMessage');

// Express treats some values passed to next() as instructions, not errors:
// next(undefined), next(null), next(0), next('') and next(false) all mean
// "carry on to the next handler" (the request would fall through to the 404
// handler and a failure would be reported as "Route not found"), and the
// strings 'route' and 'router' skip handlers. Code can throw or reject with
// anything, so always hand Express a real Error.
const toError = (value) =>
  value instanceof Error
    ? value
    : new Error(`Non-error value thrown: ${getErrorMessage(value)}`, { cause: value });

// Wrap a route handler so that ANY failure, a rejected promise or a
// synchronous throw, is passed to Express's error handling (next) instead of
// causing an unhandled rejection or an unanswered request.
const catchAsync = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(toError(error));
  }
};

module.exports = catchAsync;
