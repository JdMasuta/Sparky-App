// backend/src/server.js
import "./init/env.js"; // must load env before any config module reads it
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { promises as fs } from "fs";
import {
  initializeDatabase,
  closeDatabase,
  getDatabase,
} from "./init/db.init.js";
import {
  serverConfig,
  securityConfig,
} from "./services/config/server.config.js";
import cableDataRoutes from "./services/routes/cableDataRoutes.js";
import emailRoutes from "./services/routes/emailRoutes.js";
import errorHandler from "./services/middleware/errorHandler.js";
import authRoutes from "./services/routes/authRoutes.js";
import { requireAdmin } from "./services/middleware/requireAdmin.js";
import { sendReportToEmail } from "./services/controllers/emailController.js";
import pullRoutes from "./services/routes/pullRoutes.js";
import plcRoutes from "./services/routes/plcRoutes.js";
import systemRoutes from "./services/routes/systemRoutes.js";
import adminRoutes from "./services/routes/adminRoutes.js";
import { expireInactiveProjects } from "./services/db/projectExpiry.js";
import { runDailyBackup } from "./services/db/backup.js";
import { createShutdown } from "./init/lifecycle.js";
import { createDrainController } from "./services/lifecycle/drain.js";
import { activeMonitorCount } from "./services/controllers/pullController.js";
import { plcBridge } from "./services/clients/plcBridgeClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Ensure log directory exists
try {
  await fs.mkdir(serverConfig.paths.logs, { recursive: true });
} catch (err) {
  console.error("Failed to create logs directory:", err);
}

// Rate limiters (scoped to /api below — static assets, index.html, and /health
// are exempt). Native installs have no proxy, so X-Forwarded-For is ignored
// (clients could spoof their limiter key). In the container deployment the
// edge proxy overwrites X-Forwarded-For with the real peer address and sets
// TRUST_PROXY=1, so exactly one proxy hop is trusted.
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
const apiLimiter = rateLimit(securityConfig.rateLimiting.api);
const authLimiter = rateLimit(securityConfig.rateLimiting.auth);

// Middleware setup

// Middleware function to log timestamp and request details
const loggerMiddleware = (req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next(); // Pass control to the next middleware or route handler
};

// Use the middleware for all routes
app.use(loggerMiddleware);

// Security headers. CSP is disabled for now because the current built frontend
// still references CDN scripts (removed in the Phase 4 facelift); once those are
// gone a strict same-origin CSP can be enabled here.
app.use(helmet({ contentSecurityPolicy: false }));

// CORS restricted to an allowlist (was origin:"*" with credentials, which is
// invalid and unsafe). In production the SPA is same-origin; dev uses :5173.
app.use(
  cors({
    origin: serverConfig.corsOrigin,
    credentials: true,
    methods: securityConfig.cors.methods,
    allowedHeaders: securityConfig.cors.allowedHeaders,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Setup
// General limiter for all API traffic; a stricter one for login attempts
// (failed attempts only — successful logins don't count, see config).
app.use("/api", apiLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth", authRoutes);
// Intent-based Checkout endpoints (operator-facing, open, DB-validated).
// Drain mode (container updates): refuses new checkout starts while an update
// waits for in-flight pulls to finish. Inert unless an update supervisor asks.
const drain = createDrainController({
  activeMonitors: activeMonitorCount,
  readStep: async () => (await plcBridge.read(["stepNumber"])).stepNumber,
});
app.use("/api/pull", drain.middleware, pullRoutes);
// Raw PLC diagnostics — admin only.
app.use("/api/plc", requireAdmin, plcRoutes);
// Email report triggers — admin only.
app.use("/api/email", requireAdmin, emailRoutes);
// System info + remote update — admin only. MUST be before the generic /api
// router below, whose /:table catch-all would otherwise swallow /api/system/*.
app.use("/api/system", requireAdmin, systemRoutes);
// Aggregated admin dashboard data — admin only. Must also precede the generic
// /api router so its /:table catch-all doesn't swallow /api/admin/*.
app.use("/api/admin", requireAdmin, adminRoutes);
app.use("/api", cableDataRoutes);

// Health check endpoint — MUST be registered before the SPA catch-all below,
// otherwise `app.get("*")` shadows it and serves index.html. The edge updater
// and CI probe this endpoint.
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    environment: serverConfig.environment,
    databasePath: serverConfig.paths.database,
  });
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "public")));

// Handle React routing by serving index.html for all unmatched non-API routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(errorHandler);

// Setup logging based on environment
if (serverConfig.environment === "development") {
  const writeLog = async (message) => {
    try {
      await fs.appendFile(serverConfig.logging.file, message);
    } catch (err) {
      console.error("Failed to write to log file:", err);
    }
  };

  app.use(async (req, res, next) => {
    const logMessage = `${new Date().toISOString()} ${req.method} ${req.url}\n`;
    await writeLog(logMessage);
    console.log(logMessage.trim());
    next();
  });
}

// Utility function to format timestamp
const formatTimestamp = (date) => {
  const pad = (n) => (n < 10 ? "0" + n : n);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
};

function getMostRecentFridayDate() {
  const now = new Date();
  const daysAgo = (now.getDay() + 2) % 7; // days since last Friday
  const friday = new Date(now);
  friday.setDate(now.getDate() - daysAgo);
  friday.setHours(15, 30, 0, 0);
  if (friday > now) friday.setDate(friday.getDate() - 7);
  return friday;
}

async function runWeeklyReport(timestamp) {
  const db = getDatabase();
  const recipients = db.prepare("SELECT email FROM report_recipients").all();
  let success = true;
  let errorMessage = null;

  for (const { email } of recipients) {
    let sent = false;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await sendReportToEmail(timestamp, email);
        sent = true;
        break;
      } catch (err) {
        lastError = err;
        console.error(
          `Weekly report attempt ${attempt}/3 failed for ${email}:`,
          err.message,
        );
      }
    }
    if (!sent) {
      success = false;
      errorMessage = lastError?.message ?? "Unknown error";
    }
  }

  db.prepare(
    "INSERT INTO weekly_report_status (success, error_message) VALUES (?, ?)",
  ).run(success ? 1 : 0, errorMessage);
  return success;
}

// Scheduled jobs; handles are kept so graceful shutdown can stop them.
const cronTasks = [];

// Weekly Cron Job — every Friday at 3:30 PM
cronTasks.push(cron.schedule("30 15 * * 5", async () => {
  console.log("Starting weekly report job...");
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const timestamp = formatTimestamp(oneWeekAgo);
  const success = await runWeeklyReport(timestamp);
  console.log(
    success
      ? "Weekly report completed."
      : "Weekly report finished with errors.",
  );
}));

// Daily at 2:00 AM — mark projects with no checkouts for two months INACTIVE
cronTasks.push(cron.schedule("0 2 * * *", () => {
  try {
    const expired = expireInactiveProjects(getDatabase());
    console.log(`Project expiry job: ${expired} project(s) set INACTIVE.`);
  } catch (error) {
    console.error("Project expiry job failed:", error);
  }
}));

// Daily at 4:45 PM — copy the DB to SPARKY_BACKUP_DIR (host-visible in the
// container deployment), so a fresh backup exists before each update window
// opens at 5 PM. No-op when SPARKY_BACKUP_DIR is unset.
cronTasks.push(cron.schedule("45 16 * * *", async () => {
  try {
    const result = await runDailyBackup({ db: getDatabase(), dir: process.env.SPARKY_BACKUP_DIR });
    if (result) {
      console.log(`Daily DB backup written to ${result.file} (${result.pruned.length} old copy/copies pruned).`);
    }
  } catch (error) {
    console.error("Daily DB backup failed:", error);
  }
}));

// Start server
const startServer = async () => {
  try {
    // Initialize database
    await initializeDatabase();

    // Retry last report if it failed
    const db = getDatabase();
    const lastStatus = db
      .prepare(
        "SELECT * FROM weekly_report_status ORDER BY ran_at DESC LIMIT 1",
      )
      .get();
    if (lastStatus && lastStatus.success === 0) {
      console.log("Last weekly report failed — retrying on startup...");
      const lastFriday = getMostRecentFridayDate();
      const weekBefore = new Date(lastFriday);
      weekBefore.setDate(weekBefore.getDate() - 7);
      await runWeeklyReport(formatTimestamp(weekBefore));
    }

    // Error handling middleware
    app.use(async (err, req, res, next) => {
      const errorMessage = `${new Date().toISOString()} ERROR: ${err.stack}\n`;
      await fs.appendFile(serverConfig.logging.file, errorMessage);
      console.error(errorMessage);
      res.status(500).send("Something broke!");
    });

    // Start server
    const server = app.listen(serverConfig.port, "0.0.0.0", async () => {
      const startMessage = `${new Date().toISOString()} Server running in ${
        serverConfig.environment
      } mode on port ${serverConfig.port}\n`;
      await fs.appendFile(serverConfig.logging.file, startMessage);
      console.log(startMessage.trim());
    });

    // Graceful shutdown: stop cron, drain HTTP, then close the DB (see
    // init/lifecycle.js — closing the DB first broke in-flight requests).
    const shutdown = createShutdown({
      server,
      closeDatabase,
      cronTasks,
      log: async (message) => {
        console.log(message);
        try {
          await fs.appendFile(serverConfig.logging.file, message + "\n");
        } catch {
          /* logging must never block shutdown */
        }
      },
      // Under the container supervisor, report the clean stop over IPC first.
      exit: (code) => {
        if (!process.send || !process.connected) return process.exit(code);
        try {
          process.send({ type: "stopped", code }, () => process.exit(code));
        } catch {
          process.exit(code);
        }
      },
    });

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    // Update-handover control from the container supervisor (deploy/container),
    // over the IPC channel it opens. Native runs have no IPC channel.
    if (process.send) {
      process.on("message", async (msg) => {
        if (msg?.type === "drain") {
          const result = await drain.start(Number(msg.deadlineMs) || 600000);
          process.send({ type: "drain-result", ...result });
        } else if (msg?.type === "resume") {
          drain.resume();
        } else if (msg?.type === "shutdown") {
          await shutdown();
        }
      });
    }
  } catch (error) {
    const errorMessage = `${new Date().toISOString()} Failed to start server: ${error}\n`;
    await fs.appendFile(serverConfig.logging.file, errorMessage);
    console.error(errorMessage.trim());
    process.exit(1);
  }
};

await startServer();
