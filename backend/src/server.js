// backend/src/server.js
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { promises as fs } from "fs";
import { initializeDatabase, closeDatabase } from "./init/db.init.js";
import {
  serverConfig,
  securityConfig,
} from "./services/config/server.config.js";
import cableDataRoutes from "./services/routes/cableDataRoutes.js";
import RSLinxRoutes from "./services/routes/RSLinxRoutes.js";
import emailRoutes from "./services/routes/emailRoutes.js";
import errorHandler from "./services/middleware/errorHandler.js";
import { sendCheckoutReport } from "./services/controllers/emailController.js";

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
app.use(limiter);

app.use(
  cors({
    origin: serverConfig.corsOrigin,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Setup
app.use("/api/rslinx", RSLinxRoutes);
app.use("/api/email", emailRoutes);
app.use("/api", cableDataRoutes);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "public")));

// Handle React routing by serving index.html for all unmatched routes
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

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    environment: serverConfig.environment,
    databasePath: serverConfig.paths.database,
  });
});

// Utility function to format timestamp
const formatTimestamp = (date) => {
  const pad = (n) => (n < 10 ? "0" + n : n);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
};

// Weekly Cron Job
// Cron format: minute hour day month day_of_week
cron.schedule("30 15 * * 5", async () => {
  // Every Friday at 3:30 PM
  console.log("Starting weekly report job...");

  try {
    // Generate timestamp for one week ago
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const timestamp = formatTimestamp(oneWeekAgo);

    // List of emails to send the report to
    const emailList = ["ruben.lara@bwpackaging.com"];

    for (const email of emailList) {
      console.log(`Sending report to ${email}`);
      await sendCheckoutReport({
        body: { timestamp, email },
      });
    }

    console.log("Weekly report job completed successfully.");
  } catch (error) {
    console.error("Error during weekly report job:", error);
  }
});

// Start server
const startServer = async () => {
  try {
    // Initialize database
    await initializeDatabase();

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
