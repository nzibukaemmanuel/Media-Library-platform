require('dotenv').config();

const app = require('./src/app');
const { connectDB, closeDB } = require('./src/config/db');
const { registerProcessHandlers } = require('./src/utils/processHandlers');

const PORT = process.env.PORT || 5000;

let server;

// Register first, so even a failure during startup is logged and shuts down
// cleanly instead of crashing the process abruptly.
const { shutdown } = registerProcessHandlers({ getServer: () => server, closeDB });

const startServer = async () => {
  try {
    // Do not accept requests unless the database is reachable
    await connectDB();

    // Express 5 passes listen errors (e.g. EADDRINUSE: port already taken)
    // to this callback instead of throwing, so it must check for one.
    // Otherwise it would announce "Server running" while nothing listens.
    server = app.listen(PORT, (error) => {
      if (error) {
        console.error(`Failed to listen on port ${PORT}:`, error.message || error.code || error);
        void shutdown('listen error', 1);
        return;
      }
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message || error.code || error);
    process.exit(1);
  }
};

void startServer();
