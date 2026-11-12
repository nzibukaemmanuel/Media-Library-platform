// Process-level safety net: what the app does when something goes wrong
// outside of a request, or when it is asked to stop.
//
//   SIGINT / SIGTERM      -> graceful shutdown, exit code 0
//   unhandledRejection    -> log it, graceful shutdown, exit code 1
//   uncaughtException     -> log it, graceful shutdown, exit code 1
//
// Errors inside request handlers never get here: catchAsync passes them to
// the error handler. These events mean a bug escaped (e.g. a rejected
// promise nobody awaited). After one, the app's state can no longer be
// trusted, so the safest response is to log it, finish the requests already
// in progress, release the database and exit, and let the process manager
// (Docker, PM2, systemd...) start a fresh instance.

const DEFAULT_TIMEOUT_MS = 10000;

const describe = (reason) =>
  reason instanceof Error ? reason.stack || reason.message : `${typeof reason}: ${String(reason)}`;

// Wire up the handlers on `proc` (the real process by default).
//   getServer  () => http.Server | undefined   (the server may not exist yet)
//   closeDB    () => Promise                    (releases database connections)
//   timeoutMs  how long to wait before forcing the exit
// Returns { shutdown } so callers (and tests) can trigger a shutdown too.
const registerProcessHandlers = ({
  proc = process,
  getServer = () => undefined,
  closeDB = async () => {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  log = console,
} = {}) => {
  let shuttingDown = false;

  // Stop accepting connections, let in-flight requests finish, then resolve.
  // Keep-alive connections would otherwise hold server.close() open until
  // their own timeout (5 s by default). Idle ones are closed straight away,
  // and the check repeats because a connection only becomes idle after its
  // in-flight request completes.
  const closeServer = (server) =>
    new Promise((resolve) => {
      if (!server) return resolve();
      const sweep = setInterval(() => server.closeIdleConnections?.(), 100);
      sweep.unref?.();
      // The callback also fires (with an error) if the server was not running
      server.close(() => {
        clearInterval(sweep);
        resolve();
      });
      server.closeIdleConnections?.();
    });

  const shutdown = async (reason, exitCode) => {
    if (shuttingDown) {
      log.error(`${reason} received while already shutting down; waiting for it to finish`);
      return;
    }
    shuttingDown = true;
    log.error(`[${new Date().toISOString()}] ${reason}; shutting down...`);

    // If closing hangs (a stuck request, a database that never answers),
    // do not hang with it. unref() so this timer alone never keeps the
    // process alive.
    const forceTimer = setTimeout(() => {
      log.error(`Shutdown took longer than ${timeoutMs} ms; forcing exit`);
      getServer()?.closeAllConnections?.();
      proc.exit(1);
    }, timeoutMs);
    forceTimer.unref?.();

    let code = exitCode;
    try {
      await closeServer(getServer());
      await closeDB();
    } catch (error) {
      log.error('Error during shutdown:', error?.message || error);
      code = 1;
    }

    clearTimeout(forceTimer);
    proc.exit(code);
  };

  proc.on('SIGINT', () => void shutdown('SIGINT', 0));
  proc.on('SIGTERM', () => void shutdown('SIGTERM', 0));

  proc.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection:', describe(reason));
    void shutdown('unhandledRejection', 1);
  });

  proc.on('uncaughtException', (error) => {
    log.error('Uncaught exception:', describe(error));
    void shutdown('uncaughtException', 1);
  });

  return { shutdown };
};

module.exports = { registerProcessHandlers };
