// Wrap a route handler so that ANY failure, a rejected promise or a
// synchronous throw, is passed to Express's error handling (next) instead of
// causing an unhandled rejection or an unanswered request.
const catchAsync = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

module.exports = catchAsync;
