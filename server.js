require('dotenv').config();

const app = require('./src/app');
const { connectDB, closeDB } = require('./src/config/db');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Do not accept requests unless the database is reachable
    await connectDB();

    const server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });

    const shutdown = (signal) => {
      console.log(`${signal} received, shutting down...`);
      server.close(async () => {
        await closeDB();
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('Failed to start server:', error.message || error.code || error);
    process.exit(1);
  }
};

void startServer();
