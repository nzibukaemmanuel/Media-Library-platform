// Wrap an async route handler so a rejected promise is passed to Express's
// error handling (next) instead of causing an unhandled rejection.
const catchAsync = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

module.exports = catchAsync;
