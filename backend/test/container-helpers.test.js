import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { restoreSnapshot } from "../../deploy/container/restore-snapshot.mjs";
import { importData } from "../../deploy/container/import-data.mjs";
import { setHashLine, setAdminPassword } from "../../deploy/container/set-admin-password.mjs";
import { hashPassword, verifyPassword } from "../src/services/auth/crypto.js";

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "helpers-"));
const read = (p) => fs.readFile(p, "utf8");

// ---- restore-snapshot ------------------------------------------------------------
test("restoreSnapshot replaces the DB and drops stale journals", async () => {
  const dir = await tmp();
  const db = path.join(dir, "prod.sqlite");
  await fs.writeFile(db, "migrated-by-new-version");
  await fs.writeFile(`${db}-journal`, "x");
  await fs.writeFile(`${db}-wal`, "x");
  await fs.writeFile(path.join(dir, "pre-u-1.sqlite"), "snapshot");
  assert.equal(await restoreSnapshot(path.join(dir, "pre-u-1.sqlite"), db), 0);
  assert.equal(await read(db), "snapshot");
  for (const s of ["-journal", "-wal", "-shm"]) await assert.rejects(fs.access(`${db}${s}`));
  await assert.rejects(fs.access(`${db}.restore-tmp`));
});

test("restoreSnapshot returns 3 and leaves the DB alone when the snapshot is missing", async () => {
  const dir = await tmp();
  const db = path.join(dir, "prod.sqlite");
  await fs.writeFile(db, "current");
  assert.equal(await restoreSnapshot(path.join(dir, "nope.sqlite"), db), 3);
  assert.equal(await read(db), "current");
});

// ---- import-data -----------------------------------------------------------------
async function nativeDir({ backend, bridge, files = {} } = {}) {
  const dir = await tmp();
  await fs.writeFile(
    path.join(dir, "backend.env"),
    backend ?? `ADMIN_PASSWORD_HASH=${hashPassword("pw-123456")}\nSESSION_SECRET=abc\n`,
  );
  await fs.writeFile(path.join(dir, "microservice.env"), bridge ?? "PLC_MODE=real\nPLC_IP=10.1.2.3\n");
  for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(dir, name), content);
  return dir;
}

test("importData copies the DB and env files with private permissions", async () => {
  const from = await nativeDir({ files: { "prod.sqlite": "db" } });
  const to = path.join(await tmp(), "data");
  const { copied, notes } = await importData({ from, to });
  assert.deepEqual(copied, ["prod.sqlite", "backend.env", "microservice.env"]);
  assert.deepEqual(notes, []);
  assert.equal(await read(path.join(to, "prod.sqlite")), "db");
  assert.equal((await fs.stat(path.join(to, "backend.env"))).mode & 0o777, 0o600);
  assert.equal(await read(path.join(to, "microservice.env")), "PLC_MODE=real\nPLC_IP=10.1.2.3\n");
});

test("importData never overwrites an existing database", async () => {
  const from = await nativeDir({ files: { "prod.sqlite": "new" } });
  const to = await tmp();
  await fs.writeFile(path.join(to, "prod.sqlite"), "existing");
  await assert.rejects(importData({ from, to }), /refusing to overwrite/);
  assert.equal(await read(path.join(to, "prod.sqlite")), "existing");
});

test("importData requires the admin hash and session secret", async () => {
  const from = await nativeDir({ backend: "SESSION_SECRET=abc\n" });
  await assert.rejects(importData({ from, to: await tmp() }), /ADMIN_PASSWORD_HASH/);
});

test("importData adds PLC_MODE only when asked, and requires PLC_IP for real mode", async () => {
  const noMode = await nativeDir({ bridge: "PLC_IP=10.1.2.3\nBRIDGE_TOKEN=t" });
  await assert.rejects(importData({ from: noMode, to: await tmp() }), /--plc-mode/);
  const to = await tmp();
  const { notes } = await importData({ from: noMode, to, plcMode: "real" });
  assert.deepEqual(notes, ["added PLC_MODE=real to microservice.env", "no database found; the app will create an empty one"]);
  assert.equal(await read(path.join(to, "microservice.env")), "PLC_IP=10.1.2.3\nBRIDGE_TOKEN=t\nPLC_MODE=real\n");
  const noIp = await nativeDir({ bridge: "PLC_MODE=real\n" });
  await assert.rejects(importData({ from: noIp, to: await tmp() }), /PLC_IP is required/);
  const sim = await nativeDir({ bridge: "PLC_MODE=sim\n" });
  await importData({ from: sim, to: await tmp() });
});

test("importData refuses while the native app still has the DB open", async () => {
  const from = await nativeDir({ files: { "prod.sqlite": "db", "prod.sqlite-journal": "j" } });
  await assert.rejects(importData({ from, to: await tmp() }), /still running/);
});

// ---- set-admin-password ----------------------------------------------------------
test("setHashLine replaces an existing line or appends one", () => {
  assert.equal(setHashLine("A=1\nADMIN_PASSWORD_HASH=old\nB=2\n", "new"), "A=1\nADMIN_PASSWORD_HASH=new\nB=2\n");
  assert.equal(setHashLine("A=1", "new"), "A=1\nADMIN_PASSWORD_HASH=new\n");
});

test("setAdminPassword stores only a verifiable hash and keeps other settings", async () => {
  const dir = await tmp();
  const env = path.join(dir, "backend.env");
  await fs.writeFile(env, "SESSION_SECRET=keep\nADMIN_PASSWORD_HASH=old\n");
  await setAdminPassword(env, "correct horse");
  const text = await read(env);
  assert.match(text, /^SESSION_SECRET=keep$/m);
  assert.ok(!text.includes("correct horse"));
  const hash = /^ADMIN_PASSWORD_HASH=(.*)$/m.exec(text)[1];
  assert.ok(verifyPassword("correct horse", hash));
  assert.equal((await fs.stat(env)).mode & 0o777, 0o600);
  await assert.rejects(setAdminPassword(env, "short"), /at least 8/);
});

test("importData reports unreadable sources instead of 'not found'", { skip: process.getuid?.() === 0 }, async () => {
  const from = await nativeDir();
  await fs.chmod(from, 0o000);
  try {
    await assert.rejects(importData({ from, to: await tmp() }), /Cannot read .*EACCES/);
  } finally {
    await fs.chmod(from, 0o700);
  }
});
