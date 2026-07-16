// backend/src/services/config/server.config.js
import path from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

// Get application root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../"); // backend/src

// Legacy data location (inside the code tree). Kept for the one-time relocation.
const LEGACY_DATA_DIR = path.join(ROOT_DIR, "database");

// Runtime data directory (SQLite DB, .env, logs). In production this is set to a
// path OUTSIDE the release tree (via SPARKY_DATA_DIR) so updates never clobber
// data; unset (local dev) it defaults to the legacy in-tree location so DX is
// unchanged.
const DATA_DIR = process.env.SPARKY_DATA_DIR
  ? path.resolve(process.env.SPARKY_DATA_DIR)
  : LEGACY_DATA_DIR;

export const serverConfig = {
  port: process.env.PORT || 3000,
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",")
    : [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://10.16.49.1:5173",
        "http://localhost:3000",
      ],
  environment: process.env.NODE_ENV || "development",
  paths: {
    root: ROOT_DIR,
    logs: path.join(DATA_DIR, "logs"),
    database: DATA_DIR,
    legacyDatabase: LEGACY_DATA_DIR,
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
    file: path.join(DATA_DIR, "logs", "server.log"),
  },
};

// Admin authentication. The password is never stored — only its scrypt hash,
// generated with `node backend/scripts/hash-password.js <password>`.
const isProd = (process.env.NODE_ENV || "development") === "production";
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProd) {
    console.error(
      "FATAL: SESSION_SECRET is not set in production. Admin sessions would be forgeable."
    );
  }
  // Dev fallback: ephemeral random secret (sessions won't survive a restart).
  sessionSecret = randomBytes(32).toString("hex");
  if (!isProd) console.warn("SESSION_SECRET not set — using an ephemeral dev secret.");
}

export const securityConfig = {
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || "",
  sessionSecret,
  sessionTtlMs: Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000), // 8h
  cookieName: "sparky_session",
  // Custom header required on admin mutations (CSRF defense; with SameSite=Strict
  // cookies this is sufficient for a same-origin LAN app).
  csrfHeader: "x-requested-by",
  csrfValue: "sparky",

  rateLimiting: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  },
  cors: {
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "X-Requested-By"],
    credentials: true,
  },
};

// Create required directories if they don't exist
import fs from "fs";
[serverConfig.paths.logs, serverConfig.paths.database].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});
