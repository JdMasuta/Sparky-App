// Daily database backup to a host-visible directory (#25). In the container
// deployment the live DB sits in a Docker volume, which a Docker data purge or
// a removed WSL distro would delete; SPARKY_BACKUP_DIR is a bind mount to
// C:\SparkyData\backups so a recent copy always survives on the Windows host.
// Unset (native installs) -> no-op.
import { promises as fs } from "fs";
import path from "path";

const pad = (n) => String(n).padStart(2, "0");
/** Local-date stamp (YYYY-MM-DD) in the process time zone (TZ). */
const dateStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Copy the live DB (online, via SQLite's backup API) to
 * `<dir>/<db-name>-YYYY-MM-DD.sqlite`, keeping the newest `keep` copies.
 * @param {object} o
 * @param {import("better-sqlite3").Database} o.db
 * @param {string} [o.dir]  backup directory; falsy -> skip
 * @param {number} [o.keep]
 * @param {Date} [o.now]
 * @returns {Promise<{file: string, pruned: string[]} | null>}
 */
export async function runDailyBackup({ db, dir, keep = 14, now = new Date() }) {
  if (!dir) return null;
  const base = path.basename(db.name, path.extname(db.name)) || "sparky";
  const file = path.join(dir, `${base}-${dateStamp(now)}.sqlite`);
  const tmp = `${file}.tmp`;

  await fs.mkdir(dir, { recursive: true });
  // Write to a temp name first so a half-written copy never looks like a backup.
  await db.backup(tmp);
  await fs.rename(tmp, file);

  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{4}-\\d{2}-\\d{2}\\.sqlite$`);
  const copies = (await fs.readdir(dir)).filter((f) => pattern.test(f)).sort().reverse();
  const pruned = copies.slice(keep);
  for (const old of pruned) await fs.rm(path.join(dir, old), { force: true });
  return { file, pruned };
}
