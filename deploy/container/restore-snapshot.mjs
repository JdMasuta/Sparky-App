// One-off rollback helper (#25): put a pre-update DB snapshot back in place.
// The orchestrator runs it in the OLD image with only the data volume mounted
// and no network, after both app containers have stopped (see
// deploy/edge/app-spec.mjs buildRestoreHelperSpec).
//
//   node deploy/container/restore-snapshot.mjs --snapshot <file> --db <file>
//
// Exit codes: 0 restored, 3 snapshot not found, 1 failed (DB left untouched).
import { promises as fs } from "node:fs";
import path from "node:path";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function fsyncPath(p) {
  const fh = await fs.open(p, "r");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Atomically replace `db` with a copy of `snapshot`. */
export async function restoreSnapshot(snapshot, db) {
  try {
    await fs.access(snapshot);
  } catch {
    return 3;
  }
  const tmp = `${db}.restore-tmp`;
  await fs.copyFile(snapshot, tmp);
  await fsyncPath(tmp);
  await fs.rename(tmp, db);
  // A journal/WAL left by the newer version must not be replayed onto the snapshot.
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    await fs.rm(`${db}${suffix}`, { force: true });
  }
  await fsyncPath(path.dirname(db));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("restore-snapshot.mjs")) {
  const snapshot = arg("snapshot");
  const db = arg("db");
  if (!snapshot || !db) {
    console.error("Usage: restore-snapshot.mjs --snapshot <file> --db <file>");
    process.exit(1);
  }
  try {
    const code = await restoreSnapshot(snapshot, db);
    console.log(code === 0 ? `Restored ${db} from ${snapshot}` : `Snapshot ${snapshot} not found; database left as is`);
    process.exit(code);
  } catch (err) {
    console.error(`Restore failed: ${err.message}`);
    process.exit(1);
  }
}
