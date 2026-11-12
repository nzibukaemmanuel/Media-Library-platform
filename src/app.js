
const express = require('express');

const mediaRoutes = require('./routes/mediaRoutes');
const { errorHandler, notFound } = require('./middlewares/errorHandler');
const { sendSuccess } = require('./utils/apiResponse');

const app = express();
app.disable('x-powered-by');

// Built-in middleware to parse JSON request bodies
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  sendSuccess(res, { data: { message: 'Welcome to Media Library Platform API' } });
});

// Health-check route
app.get('/api/health', (req, res) => {
  sendSuccess(res, { data: { message: 'Server is running successfully' } });
});

// Media API. The brief's paths are /media/...; /api/media/... is kept as an
// alias, so existing callers and the /api/health route share one prefix.
app.use('/media', mediaRoutes);
app.use('/api/media', mediaRoutes);

// Unknown routes -> 404, then every error -> one consistent JSON response.
// errorHandler must be registered last.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
