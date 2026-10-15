// Orchestrator persistence (#25). Two volumes:
//   /state (sparky-edge-state, orchestrator only): edge.json with the active
//          container, the previous image, the update record and the secret.
//   /route (sparky-route, orchestrator rw, proxy ro): active.json (proxy
//          target) and status.json (sanitized update status, no secrets).
// Every write is atomic (temp file, fsync, rename) so a reboot mid-update
// never leaves a torn file behind.
import { promises as fs } from "node:fs";
import path from "node:path";

export function initialState() {
  return { version: 1, secret: null, active: null, previous: null, update: null, history: [] };
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

export async function writeJsonAtomic(file, value) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  const fh = await fs.open(tmp, "w", 0o640);
  try {
    await fh.writeFile(JSON.stringify(value, null, 2) + "\n");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, file);
}

export function createStore({ stateDir, routeDir }) {
  const stateFile = path.join(stateDir, "edge.json");
  return {
    async load() {
      return { ...initialState(), ...(await readJson(stateFile, initialState())) };
    },
    save: (state) => writeJsonAtomic(stateFile, state),
    writeRoute: (route) => writeJsonAtomic(path.join(routeDir, "active.json"), route),
    writeStatus: (status) => writeJsonAtomic(path.join(routeDir, "status.json"), status),
  };
}
