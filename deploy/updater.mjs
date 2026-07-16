// Sparky edge updater. Runs under the portable node.exe (no PowerShell, since a
// locked-down device may block .ps1 execution). Checks GitHub Releases, and on a
// newer version: downloads + verifies the SHA-256, backs up the current install,
// swaps in the new code, restarts, health-checks, and rolls back on failure.
//
// The runtime (portable node) and the data dir (SQLite/.env/logs) live OUTSIDE
// the release bundle and are never touched by an update.
//
// Usage:
//   node deploy/updater.mjs --check     # report only, make no changes
//   node deploy/updater.mjs             # apply an update if one is available
import { createHash } from "crypto";
import { createReadStream, promises as fs } from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The updater is normally copied to %TEMP% and run from there (so it doesn't sit
// inside the tree it replaces), so the install root is passed via env; fall back
// to the location relative to this file for a direct in-tree run.
const INSTALL_ROOT = process.env.SPARKY_INSTALL_ROOT
  ? path.resolve(process.env.SPARKY_INSTALL_ROOT)
  : path.resolve(__dirname, ".."); // contains backend/, microservice/, runtime/, data/
// Directories and root files swapped on update (the portable runtime and the
// data dir are deliberately NOT touched).
const REPLACE_DIRS = ["backend", "microservice", "deploy"];
const REPLACE_FILES = ["sparky.bat", "README.md"];

// ---- pure helpers (unit-tested) -------------------------------------------
export function parseVersion(v) {
  return String(v)
    .replace(/^v/, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

export function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

export function pickAssets(release) {
  const assets = release.assets || [];
  const zip = assets.find((a) => /\.zip$/.test(a.name));
  const manifest = assets.find((a) => a.name === "manifest.json");
  return { zip, manifest };
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("error", reject)
      .on("data", (d) => hash.update(d))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

// ---- config ---------------------------------------------------------------
async function loadConfig() {
  const defaults = { repo: process.env.SPARKY_UPDATE_REPO || "JdMasuta/Sparky-App", port: process.env.PORT || 3000 };
  try {
    const raw = await fs.readFile(path.join(__dirname, "update.config.json"), "utf8");
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

async function currentVersion() {
  const pkg = JSON.parse(await fs.readFile(path.join(INSTALL_ROOT, "backend", "package.json"), "utf8"));
  return pkg.version;
}

async function fetchLatestRelease(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { "User-Agent": "sparky-updater", Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { "User-Agent": "sparky-updater" } });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function healthCheck(port, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

// ---- main flow ------------------------------------------------------------
async function main() {
  const checkOnly = process.argv.includes("--check");
  const cfg = await loadConfig();
  const current = await currentVersion();
  console.log(`Current version: ${current} (repo ${cfg.repo})`);

  const release = await fetchLatestRelease(cfg.repo);
  const remote = String(release.tag_name || "").replace(/^v/, "");
  console.log(`Latest release: ${remote}`);

  if (!isNewer(remote, current)) {
    console.log("Already up to date.");
    return;
  }
  const { zip, manifest } = pickAssets(release);
  if (!zip || !manifest) throw new Error("Release is missing the zip or manifest.json asset");

  if (checkOnly) {
    console.log(`Update available: ${current} -> ${remote}`);
    return;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sparky-upd-"));
  const zipPath = path.join(tmp, zip.name);
  console.log("Downloading manifest and bundle…");
  await download(manifest.browser_download_url, path.join(tmp, "manifest.json"));
  const man = JSON.parse(await fs.readFile(path.join(tmp, "manifest.json"), "utf8"));
  await download(zip.browser_download_url, zipPath);

  console.log("Verifying checksum…");
  const actual = await sha256File(zipPath);
  if (man.sha256 && actual.toLowerCase() !== String(man.sha256).toLowerCase()) {
    throw new Error(`Checksum mismatch (expected ${man.sha256}, got ${actual})`);
  }

  // Extract with Windows' built-in tar (bsdtar handles .zip on Win10+).
  const extractDir = path.join(tmp, "extracted");
  await fs.mkdir(extractDir, { recursive: true });
  console.log("Extracting…");
  await run("tar", ["-xf", zipPath, "-C", extractDir]);

  // Make sure our own cwd is not inside a directory we're about to rename.
  process.chdir(os.tmpdir());

  const sparky = path.join(INSTALL_ROOT, "sparky.bat");
  // Stop services before swapping files.
  console.log("Stopping services…");
  await run(sparky, ["stop"], { shell: true }).catch(() => {});

  // Backup current dirs + root files, then replace.
  const backup = path.join(INSTALL_ROOT, "releases", `backup-${current}-${Date.now()}`);
  await fs.mkdir(backup, { recursive: true });
  console.log(`Backing up current install to ${backup}…`);
  for (const dir of REPLACE_DIRS) {
    const src = path.join(INSTALL_ROOT, dir);
    if (await exists(src)) await fs.rename(src, path.join(backup, dir));
  }
  for (const file of REPLACE_FILES) {
    const src = path.join(INSTALL_ROOT, file);
    if (await exists(src)) await fs.rename(src, path.join(backup, file));
  }
  const restoreBackup = async () => {
    for (const name of [...REPLACE_DIRS, ...REPLACE_FILES]) {
      const dest = path.join(INSTALL_ROOT, name);
      await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
      if (await exists(path.join(backup, name)))
        await fs.rename(path.join(backup, name), dest);
    }
  };
  try {
    for (const dir of REPLACE_DIRS) {
      await fs.cp(path.join(extractDir, dir), path.join(INSTALL_ROOT, dir), { recursive: true });
    }
    for (const file of REPLACE_FILES) {
      const from = path.join(extractDir, file);
      if (await exists(from)) await fs.cp(from, path.join(INSTALL_ROOT, file));
    }
    console.log("Restarting services…");
    await run(sparky, ["start", "--prod"], { shell: true, detached: true });

    console.log("Health-checking…");
    if (!(await healthCheck(cfg.port))) throw new Error("Health check failed after update");

    console.log(`Update to ${remote} complete.`);
  } catch (err) {
    console.error(`Update failed: ${err.message}. Rolling back…`);
    await restoreBackup();
    await run(sparky, ["start", "--prod"], { shell: true, detached: true }).catch(() => {});
    throw err;
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith("updater.mjs")) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
