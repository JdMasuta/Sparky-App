import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createTables } from "../src/init/db.init.js";
import { runMigrations, LATEST_MIGRATION, parseAddedDate } from "../src/init/migrations.js";
import { freshDb } from "./helpers.js";

const cols = (db, table) =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

test("migration 4 adopts the items drift columns", () => {
  const db = freshDb();
  for (const c of ["purchase_type", "manufacturer_number", "spec"]) {
    assert.ok(cols(db, "items").includes(c), `items.${c} exists`);
  }
});

test("migration 5 normalizes T-separated checkout timestamps", () => {
  const db = new Database(":memory:");
  createTables(db);
  const u = db.prepare("INSERT INTO users (name) VALUES ('U')").run().lastInsertRowid;
  const p = db.prepare("INSERT INTO projects (project_number,name) VALUES ('P','P')").run().lastInsertRowid;
  const i = db.prepare("INSERT INTO items (sku,name) VALUES ('S','S')").run().lastInsertRowid;
  db.prepare("INSERT INTO checkouts (user_id,project_id,item_id,quantity,timestamp) VALUES (?,?,?,?,?)")
    .run(u, p, i, 3, "2025-03-01T09:15:00");
  runMigrations(db);
  const ts = db.prepare("SELECT timestamp FROM checkouts").get().timestamp;
  assert.equal(ts, "2025-03-01 09:15:00");
});

test("migration 6 dates projects from their 'Added M/D/YY' description", () => {
  const db = new Database(":memory:");
  createTables(db);
  db.prepare("INSERT INTO projects (project_number,name,description) VALUES ('A','A','Added 1/28/25')").run();
  db.prepare("INSERT INTO projects (project_number,name,description) VALUES ('B','B','Added 3/13/2025')").run();
  db.prepare("INSERT INTO projects (project_number,name,description) VALUES ('C','C','Automatically added from import')").run();
  runMigrations(db);
  const rows = db.prepare("SELECT project_number, created_at FROM projects ORDER BY project_number").all();
  assert.equal(rows.find((r) => r.project_number === "A").created_at, "2025-01-28 00:00:00");
  assert.equal(rows.find((r) => r.project_number === "B").created_at, "2025-03-13 00:00:00");
  // No parseable date -> keeps the generic migration-1 backfill (not the epoch).
  assert.match(rows.find((r) => r.project_number === "C").created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("parseAddedDate handles 2- and 4-digit years and rejects non-dates", () => {
  assert.equal(parseAddedDate("Added 1/28/25"), "2025-01-28 00:00:00");
  assert.equal(parseAddedDate("Added 12/5/2024"), "2024-12-05 00:00:00");
  assert.equal(parseAddedDate("Automatically added from import"), null);
  assert.equal(parseAddedDate(null), null);
  assert.equal(parseAddedDate("Added 13/40/25"), null); // invalid month/day
});

test("LATEST_MIGRATION is 6", () => {
  assert.equal(LATEST_MIGRATION, 6);
});

test("migrations add created_at to users, projects, items and backfill", () => {
  const db = new Database(":memory:");
  createTables(db);
  // pre-migration: base schema has no created_at
  assert.ok(!cols(db, "users").includes("created_at"));
  db.prepare("INSERT INTO users (name) VALUES (?)").run("Legacy User");

  runMigrations(db);

  for (const t of ["users", "projects", "items"]) {
    assert.ok(cols(db, t).includes("created_at"), `${t}.created_at exists`);
  }
  const row = db.prepare("SELECT created_at FROM users WHERE name=?").get("Legacy User");
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("migrations add status (users, projects) and a_number (projects)", () => {
  const db = freshDb();
  assert.ok(cols(db, "users").includes("status"));
  assert.ok(cols(db, "projects").includes("status"));
  assert.ok(cols(db, "projects").includes("a_number"));
  // default status is ACTIVE
  db.prepare("INSERT INTO projects (project_number, name) VALUES (?,?)").run("MO-9", "P");
  const p = db.prepare("SELECT status FROM projects WHERE project_number=?").get("MO-9");
  assert.equal(p.status, "ACTIVE");
});

test("user_version is set to the latest migration", () => {
  const db = freshDb();
  assert.equal(db.pragma("user_version", { simple: true }), LATEST_MIGRATION);
});

test("running migrations twice is idempotent (no error, no double columns)", () => {
  const db = freshDb();
  const before = cols(db, "projects").length;
  const warnings = runMigrations(db); // second run
  assert.equal(warnings.length, 0);
  assert.equal(cols(db, "projects").length, before);
  assert.equal(db.pragma("user_version", { simple: true }), LATEST_MIGRATION);
});

test("unique index on users.name is created when there are no duplicates", () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (name) VALUES (?)").run("Bob");
  assert.throws(
    () => db.prepare("INSERT INTO users (name) VALUES (?)").run("bob"),
    /UNIQUE|constraint/i,
    "case-insensitive duplicate name is rejected"
  );
});

test("duplicate user names cause the unique index to be skipped with a warning", () => {
  const db = new Database(":memory:");
  createTables(db);
  db.prepare("INSERT INTO users (name) VALUES (?)").run("Dup");
  db.prepare("INSERT INTO users (name) VALUES (?)").run("dup"); // case-insensitive dup

  const warnings = runMigrations(db);
  assert.ok(
    warnings.some((w) => w.includes("duplicate")),
    "a duplicate-name warning is returned"
  );
  // index not created -> inserting another dup still succeeds
  assert.doesNotThrow(() =>
    db.prepare("INSERT INTO users (name) VALUES (?)").run("DUP")
  );
});

test("migration runner starts from a partially-migrated (drifted) DB safely", () => {
  // Simulate a prod DB that already had status/a_number added manually.
  const db = new Database(":memory:");
  createTables(db);
  db.exec("ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'");
  db.exec("ALTER TABLE projects ADD COLUMN a_number TEXT");

  assert.doesNotThrow(() => runMigrations(db));
  assert.ok(cols(db, "projects").includes("created_at"));
  assert.equal(
    cols(db, "projects").filter((c) => c === "status").length,
    1,
    "status not duplicated"
  );
});
