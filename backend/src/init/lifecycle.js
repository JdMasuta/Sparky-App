// Graceful shutdown. Order matters: stop scheduled jobs, stop accepting
// connections and let in-flight requests finish (they may still use the DB),
// and only then close the database. After `graceMs`, lingering connections
// (e.g. a checkout monitor long-poll) are force-closed so shutdown can finish.

/**
 * @param {object} opts
 * @param {import("http").Server} opts.server
 * @param {() => void} opts.closeDatabase
 * @param {{ stop: () => void }[]} [opts.cronTasks]
 * @param {(message: string) => void | Promise<void>} [opts.log]
 * @param {(code: number) => void} [opts.exit]
 * @param {number} [opts.graceMs]
 * @returns {() => Promise<void>} idempotent shutdown function
 */
export function createShutdown({
  server,
  closeDatabase,
  cronTasks = [],
  log = (message) => console.log(message),
  exit = (code) => process.exit(code),
  graceMs = 15000,
}) {
  let pending = null;

  const run = async () => {
    await log(`${new Date().toISOString()} Server shutting down...`);

    for (const task of cronTasks) {
      try {
        task.stop();
      } catch {
        /* a cron task that fails to stop must not block shutdown */
      }
    }

    await new Promise((resolve) => {
      const timer = setTimeout(() => server.closeAllConnections?.(), graceMs);
      timer.unref?.();
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
      // Idle keep-alive sockets would otherwise hold close() open until they time out.
      server.closeIdleConnections?.();
    });

    let code = 0;
    try {
      closeDatabase();
    } catch (err) {
      code = 1;
      await log(`${new Date().toISOString()} Failed to close database: ${err.message}`);
    }

    await log(`${new Date().toISOString()} Server closed`);
    exit(code);
  };

  return () => {
    if (!pending) pending = run();
    return pending;
  };
}
