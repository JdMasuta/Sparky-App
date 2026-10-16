// System info + remote updates (admin only). Two deployments:
//   container (#25): updates are queued with the update orchestrator, which
//     runs them inside the update window with a graceful handover;
//   native (legacy): the update spawns the on-device Node updater detached so
//     it can stop/restart services itself.
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { getMigrationWarnings } from "../../init/db.init.js";
import { orchestrator, isContainerDeployment } from "../clients/orchestratorClient.js";
import { activeMonitorCount } from "./pullController.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../../../"); // backend/
const INSTALL_ROOT = path.resolve(BACKEND_ROOT, ".."); // repo/install root

const versionCache = new Map();
async function packageVersion(dir) {
  if (versionCache.has(dir)) return versionCache.get(dir);
  let version;
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
    version = pkg.version ?? "unknown";
  } catch {
    version = "unknown";
  }
  versionCache.set(dir, version);
  return version;
}

// GET /api/system/info
// `version` is the backend's own version; `productVersion` is the Sparky Cart
// product version from the install root package.json (what releases are tagged with).
export const getInfo = async (req, res) => {
  res.status(200).json({
    version: await packageVersion(BACKEND_ROOT),
    productVersion: await packageVersion(INSTALL_ROOT),
    plcMode: (process.env.PLC_MODE || "sim").toLowerCase(),
    node: process.version,
    environment: process.env.NODE_ENV || "development",
    deployment: isContainerDeployment() ? "container" : "native",
    container: process.env.SPARKY_CONTAINER_NAME || null,
    warnings: getMigrationWarnings(),
  });
};

// Orchestrator errors -> HTTP: conflicts (already up to date, update in
// progress, nothing to cancel) pass through; an unreachable orchestrator is
// 503; anything else is a bad gateway.
function sendOrchestratorError(res, err) {
  if (err.status === 409) return res.status(409).json({ error: err.message });
  if (err.status == null) return res.status(503).json({ error: err.message });
  return res.status(502).json({ error: err.message });
}

const nativeOnly = (res) =>
  res.status(501).json({
    error: "Update scheduling is available only in the container deployment.",
    deployment: "native",
  });

// GET /api/system/update/check -> current vs latest, window, update status,
// plus how many checkouts are in progress right now.
export const getUpdateCheck = async (req, res) => {
  if (!isContainerDeployment()) return nativeOnly(res);
  try {
    const check = await orchestrator.check();
    res.status(200).json({ ...check, activeMonitors: activeMonitorCount() });
  } catch (err) {
    sendOrchestratorError(res, err);
  }
};

// DELETE /api/system/update -> cancel a queued update (until the handover commits)
export const cancelUpdate = async (req, res) => {
  if (!isContainerDeployment()) return nativeOnly(res);
  try {
    const result = await orchestrator.cancelUpdate();
    res.status(result?.state === "canceling" ? 202 : 200).json(result);
  } catch (err) {
    sendOrchestratorError(res, err);
  }
};

// POST /api/system/update
//   container: queue the latest release (runs inside the update window)
//   native:    launch the legacy updater detached
export const triggerUpdate = async (req, res) => {
  if (isContainerDeployment()) {
    try {
      const queued = await orchestrator.queueUpdate();
      return res.status(202).json(queued);
    } catch (err) {
      return sendOrchestratorError(res, err);
    }
  }
  if (process.platform !== "win32") {
    return res.status(501).json({
      error: "On-device updates run only on the Windows edge device.",
    });
  }
  try {
    const script = path.join(INSTALL_ROOT, "sparky.bat");
    const child = spawn("cmd.exe", ["/c", script, "update"], {
      cwd: INSTALL_ROOT,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    res.status(202).json({ started: true, message: "Update started. Services will restart." });
  } catch (err) {
    res.status(500).json({ error: "Failed to start updater", message: err.message });
  }
};
