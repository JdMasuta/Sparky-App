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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Ensure log directory exists
try {
  await fs.mkdir(serverConfig.paths.logs, { recursive: true });
} catch (err) {
  console.error("Failed to create logs directory:", err);
}

// Initialize rate limiter
const limiter = rateLimit(securityConfig.rateLimiting);

// Middleware setup

// Middleware function to log timestamp and request details
const loggerMiddleware = (req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next(); // Pass control to the next middleware or route handler
};

// Use the middleware for all routes
app.use(loggerMiddleware);

app.use(limiter);

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
app.use("/api/auth", authRoutes);
// Intent-based Checkout endpoints (operator-facing, open, DB-validated).
app.use("/api/pull", pullRoutes);
// Raw PLC diagnostics — admin only.
app.use("/api/plc", requireAdmin, plcRoutes);
// Email report triggers — admin only.
app.use("/api/email", requireAdmin, emailRoutes);
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

// Weekly Cron Job — every Friday at 3:30 PM
cron.schedule("30 15 * * 5", async () => {
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
});

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

    // Graceful shutdown
    const shutdown = async () => {
      const shutdownMessage = `${new Date().toISOString()} Server shutting down...\n`;
      await fs.appendFile(serverConfig.logging.file, shutdownMessage);
      console.log(shutdownMessage.trim());

      await closeDatabase();
      server.close(async () => {
        const closedMessage = `${new Date().toISOString()} Server closed\n`;
        await fs.appendFile(serverConfig.logging.file, closedMessage);
        console.log(closedMessage.trim());
        process.exit(0);
      });
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (error) {
    const errorMessage = `${new Date().toISOString()} Failed to start server: ${error}\n`;
    await fs.appendFile(serverConfig.logging.file, errorMessage);
    console.error(errorMessage.trim());
    process.exit(1);
  }
};

await startServer();
