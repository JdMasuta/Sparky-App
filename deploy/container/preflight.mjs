// Standby preflight for a NEW app container (#25). Runs before the handover,
// while the old container is still serving, so it must never write: the DB is
// opened read-only and env files are parsed, not loaded.
//
//   node deploy/container/preflight.mjs   -> prints JSON, exit 0 when ok
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "../..");
const requireBackend = createRequire(path.join(APP_ROOT, "backend", "package.json"));

function readEnvFile(file) {
  if (!existsSync(file)) return null;
  const dotenv = requireBackend("dotenv");
  return dotenv.parse(readFileSync(file));
}

/**
 * @param {object} [opts]
 * @param {string} [opts.dataDir]
 * @param {string} [opts.dbFile]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {Promise<{ok: boolean, errors: string[], dbVersion: number|null, schemaVersion: number}>}
 */
export async function preflight({
  dataDir = process.env.SPARKY_DATA_DIR || "/data",
  dbFile = process.env.SPARKY_DB_FILE || "prod.sqlite",
  env = process.env,
} = {}) {
  const errors = [];
  const { LATEST_MIGRATION } = await import(
    pathToFileURL(path.join(APP_ROOT, "backend/src/init/migrations.js")).href
  );

  // 1. Native module loads (catches a broken better-sqlite3 build in the image).
  let Database = null;
  try {
    Database = requireBackend("better-sqlite3");
  } catch (err) {
    errors.push(`better-sqlite3 failed to load: ${err.message}`);
  }

  // 2. Existing DB is readable and not newer than this image understands.
  let dbVersion = null;
  const dbPath = path.join(dataDir, dbFile);
  if (!existsSync(dbPath)) {
    errors.push(`Database not found at ${dbPath}`);
  } else if (Database) {
    try {
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      try {
        dbVersion = db.pragma("user_version", { simple: true });
      } finally {
        db.close();
      }
      if (dbVersion > LATEST_MIGRATION) {
        errors.push(
          `Database schema v${dbVersion} is newer than this image supports (v${LATEST_MIGRATION}); refusing a downgrade`,
        );
      }
    } catch (err) {
      errors.push(`Database could not be opened read-only: ${err.message}`);
    }
  }

  // 3. Secrets and device config live in the data dir, never in the image.
  const backendEnv = readEnvFile(path.join(dataDir, "backend.env"));
  if (!backendEnv) {
    errors.push("backend.env not found in the data dir");
  } else {
    for (const key of ["ADMIN_PASSWORD_HASH", "SESSION_SECRET"]) {
      if (!backendEnv[key]) errors.push(`backend.env: ${key} is empty or missing`);
    }
  }
  const bridgeEnv = readEnvFile(path.join(dataDir, "microservice.env"));
  if (!bridgeEnv) {
    errors.push("microservice.env not found in the data dir");
  } else {
    const mode = (env.PLC_MODE || bridgeEnv.PLC_MODE || "").toLowerCase();
    if (!mode) errors.push("microservice.env: PLC_MODE is not set (sim or real)");
    else if (mode !== "sim" && !(env.PLC_IP || bridgeEnv.PLC_IP))
      errors.push("microservice.env: PLC_IP is required when PLC_MODE=real");
  }

  // 4. Device time zone drives the cron jobs; a bad value would shift them.
  if (!env.TZ) {
    errors.push("TZ is not set (device time zone)");
  } else {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: env.TZ });
    } catch {
      errors.push(`TZ "${env.TZ}" is not a valid IANA time zone`);
    }
  }

  return { ok: errors.length === 0, errors, dbVersion, schemaVersion: LATEST_MIGRATION };
}

if (process.argv[1] && process.argv[1].endsWith("preflight.mjs")) {
  const result = await preflight();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
