const express = require('express');
const swaggerUi = require('swagger-ui-express');

const mediaRoutes = require('./routes/mediaRoutes');
const openApiSpec = require('./docs/openapi');
const { errorHandler, notFound } = require('./middlewares/errorHandler');
const { sendSuccess } = require('./utils/apiResponse');

const app = express();
app.disable('x-powered-by');

// Built-in middleware to parse JSON request bodies
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  sendSuccess(res, { data: { message: 'Welcome to Media Library Platform API', docs: '/api-docs' } });
});

// Health-check route
app.get('/api/health', (req, res) => {
  sendSuccess(res, { data: { message: 'Server is running successfully' } });
});

// Interactive API documentation (Swagger UI). The raw OpenAPI document is
// served as-is, not in the API's response format: tools such as Postman,
// Insomnia and code generators expect the standard OpenAPI JSON.
app.get('/api-docs.json', (req, res) => {
  res.json(openApiSpec);
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: 'Media Library API' }));

// Media API. The brief's paths are /media/...; /api/media/... is kept as an
// alias, so existing callers and the /api/health route share one prefix.
app.use('/media', mediaRoutes);
app.use('/api/media', mediaRoutes);

// Unknown routes -> 404, then every error -> one consistent JSON response.
// errorHandler must be registered last.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
