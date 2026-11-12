
const express = require('express');

const app = express();
app.disable('x-powered-by');

// Built-in middleware to parse JSON request bodies
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to Media Library Platform API',
  });
});

// Health-check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running successfully',
  });
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

module.exports = app;
