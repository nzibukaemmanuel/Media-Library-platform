// A short, human-readable reason for logging any caught value.
//
// error.message is not always usable: a refused connection raises an
// AggregateError with an EMPTY message (only error.code, "ECONNREFUSED", says
// what happened), and code can throw or reject with non-Error values.
const getErrorMessage = (error) => {
  if (error instanceof Error) return error.message || error.code || error.name;
  if (error?.message) return String(error.message);
  if (error?.code) return String(error.code);
  return String(error);
};

module.exports = { getErrorMessage };
