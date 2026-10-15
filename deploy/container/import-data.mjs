// One-off cutover helper (#25): copy a native install's data dir into the
// sparky-data volume. Runs in the app image with the volume at /data and the
// native data dir mounted read-only at /import (see sparky-docker.bat
// import-data). Stop the native app first so the database is consistent.
//
//   node deploy/container/import-data.mjs --from /import [--plc-mode real|sim] [--to /data]
//
// Refuses to overwrite an existing database. Secrets stay in the env files;
// nothing here is ever written into an image.
import { promises as fs, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireBackend = createRequire(path.join(__dirname, "../../backend/package.json"));

const DB_FILES = ["prod.sqlite", "dev.sqlite"];

/** True/false for present/absent; unreadable paths are an error, not "absent". */
const exists = (p) =>
  fs.access(p).then(
    () => true,
    (err) => {
      if (err.code === "ENOENT") return false;
      throw new Error(`Cannot read ${p} (${err.code}); check permissions on the source directory`);
    },
  );

/**
 * @param {object} o
 * @param {string} o.from source data dir (native SPARKY_DATA_DIR)
 * @param {string} o.to   target data dir (the volume)
 * @param {"real"|"sim"} [o.plcMode] PLC_MODE to add if microservice.env lacks it
 * @returns {Promise<{ copied: string[], notes: string[] }>}
 */
export async function importData({ from, to, plcMode }) {
  const dotenv = requireBackend("dotenv");
  const notes = [];

  for (const db of DB_FILES) {
    if (await exists(path.join(to, db))) {
      throw new Error(`${path.join(to, db)} already exists; refusing to overwrite an existing database`);
    }
  }

  const backendEnvPath = path.join(from, "backend.env");
  const bridgeEnvPath = path.join(from, "microservice.env");
  if (!(await exists(backendEnvPath))) throw new Error(`${backendEnvPath} not found`);
  if (!(await exists(bridgeEnvPath))) throw new Error(`${bridgeEnvPath} not found`);

  const backendEnv = dotenv.parse(readFileSync(backendEnvPath));
  for (const key of ["ADMIN_PASSWORD_HASH", "SESSION_SECRET"]) {
    if (!backendEnv[key]) throw new Error(`backend.env: ${key} is empty or missing`);
  }

  let bridgeText = readFileSync(bridgeEnvPath, "utf8");
  const bridgeEnv = dotenv.parse(bridgeText);
  if (!bridgeEnv.PLC_MODE) {
    // The native launcher set PLC_MODE from `sparky start --prod`; containers
    // read it from the file only.
    if (!plcMode) {
      throw new Error("microservice.env has no PLC_MODE; rerun with --plc-mode real (or sim)");
    }
    bridgeText = `${bridgeText.replace(/\s*$/, "\n")}PLC_MODE=${plcMode}\n`;
    notes.push(`added PLC_MODE=${plcMode} to microservice.env`);
  }
  const mode = (bridgeEnv.PLC_MODE || plcMode).toLowerCase();
  if (mode !== "sim" && !bridgeEnv.PLC_IP) {
    throw new Error("microservice.env: PLC_IP is required when PLC_MODE=real");
  }

  const dbs = [];
  for (const db of DB_FILES) if (await exists(path.join(from, db))) dbs.push(db);
  if (dbs.length === 0) notes.push("no database found; the app will create an empty one");
  for (const leftover of ["prod.sqlite-journal", "prod.sqlite-wal", "dev.sqlite-journal", "dev.sqlite-wal"]) {
    if (await exists(path.join(from, leftover))) {
      throw new Error(`${leftover} exists: the native app is still running or crashed. Stop it cleanly first.`);
    }
  }

  await fs.mkdir(to, { recursive: true });
  const copied = [];
  for (const db of dbs) {
    await fs.copyFile(path.join(from, db), path.join(to, db));
    copied.push(db);
  }
  await fs.copyFile(backendEnvPath, path.join(to, "backend.env"));
  await fs.writeFile(path.join(to, "microservice.env"), bridgeText);
  for (const f of ["backend.env", "microservice.env"]) await fs.chmod(path.join(to, f), 0o600);
  copied.push("backend.env", "microservice.env");
  return { copied, notes };
}

if (process.argv[1] && process.argv[1].endsWith("import-data.mjs")) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 ? process.argv[i + 1] : undefined;
  };
  const plcMode = arg("plc-mode");
  if (plcMode && !["real", "sim"].includes(plcMode)) {
    console.error("--plc-mode must be real or sim");
    process.exit(1);
  }
  try {
    const { copied, notes } = await importData({ from: arg("from") || "/import", to: arg("to") || "/data", plcMode });
    console.log(`Imported: ${copied.join(", ")}`);
    for (const n of notes) console.log(`Note: ${n}`);
  } catch (err) {
    console.error(`Import failed: ${err.message}`);
    process.exit(1);
  }
}
