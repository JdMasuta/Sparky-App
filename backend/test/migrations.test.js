import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createTables } from "../src/init/db.init.js";
import { runMigrations, LATEST_MIGRATION } from "../src/init/migrations.js";
import { freshDb } from "./helpers.js";

const cols = (db, table) =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

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
