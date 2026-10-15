// System info + remote-update trigger (admin only). The update spawns the
// on-device Node updater detached so it can stop/restart services itself.
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { getMigrationWarnings } from "../../init/db.init.js";

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
    warnings: getMigrationWarnings(),
  });
};

// POST /api/system/update  -> launches the updater detached
export const triggerUpdate = async (req, res) => {
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
