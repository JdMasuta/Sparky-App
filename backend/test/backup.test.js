import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runDailyBackup } from "../src/services/db/backup.js";

async function liveDb() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "backup-src-"));
  const db = new Database(path.join(dir, "prod.sqlite"));
  db.exec("CREATE TABLE checkouts (id INTEGER PRIMARY KEY, qty REAL)");
  db.prepare("INSERT INTO checkouts (qty) VALUES (?)").run(42.5);
  return db;
}
const backupDir = () => fs.mkdtemp(path.join(os.tmpdir(), "backup-dst-"));

test("no backup dir configured: no-op", async () => {
  const db = await liveDb();
  assert.equal(await runDailyBackup({ db, dir: "" }), null);
  assert.equal(await runDailyBackup({ db, dir: undefined }), null);
  db.close();
});

test("writes a readable, dated copy of the live DB", async () => {
  const db = await liveDb();
  const dir = await backupDir();
  const result = await runDailyBackup({ db, dir, now: new Date(2026, 9, 16, 16, 45) });
  assert.equal(result.file, path.join(dir, "prod-2026-10-16.sqlite"));
  assert.deepEqual(await fs.readdir(dir), ["prod-2026-10-16.sqlite"], "no temp file left behind");
  const copy = new Database(result.file, { readonly: true });
  assert.equal(copy.prepare("SELECT qty FROM checkouts").get().qty, 42.5);
  copy.close();
  db.close();
});

test("creates the backup dir and overwrites the same day's copy", async () => {
  const db = await liveDb();
  const dir = path.join(await backupDir(), "nested", "backups");
  const day = new Date(2026, 9, 16, 16, 45);
  await runDailyBackup({ db, dir, now: day });
  db.prepare("INSERT INTO checkouts (qty) VALUES (?)").run(7);
  await runDailyBackup({ db, dir, now: day });
  const copy = new Database(path.join(dir, "prod-2026-10-16.sqlite"), { readonly: true });
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM checkouts").get().n, 2);
  copy.close();
  db.close();
});

test("keeps only the newest copies and leaves unrelated files alone", async () => {
  const db = await liveDb();
  const dir = await backupDir();
  await fs.writeFile(path.join(dir, "notes.txt"), "keep me");
  await fs.writeFile(path.join(dir, "pre-u-1.sqlite"), "pre-update snapshot (not ours)");
  for (let d = 1; d <= 5; d++) await runDailyBackup({ db, dir, keep: 3, now: new Date(2026, 9, d, 16, 45) });
  assert.deepEqual((await fs.readdir(dir)).sort(), [
    "notes.txt",
    "pre-u-1.sqlite",
    "prod-2026-10-03.sqlite",
    "prod-2026-10-04.sqlite",
    "prod-2026-10-05.sqlite",
  ]);
  db.close();
});
