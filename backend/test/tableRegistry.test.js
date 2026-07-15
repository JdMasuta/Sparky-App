import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateInsert,
  validateUpdate,
  isKnownTable,
  nowLocalSql,
} from "../src/services/db/tableRegistry.js";
import { freshDb, seedRefs } from "./helpers.js";

test("isKnownTable rejects unknown tables (identifier whitelist)", () => {
  assert.ok(isKnownTable("users"));
  assert.ok(!isKnownTable("sqlite_master"));
  assert.ok(!isKnownTable("users; DROP TABLE users"));
});

test("validateInsert requires required fields", () => {
  const db = freshDb();
  const r = validateInsert(db, "users", {});
  assert.equal(r.status, 422);
  assert.equal(r.field, "name");
});

test("validateInsert strips unknown and readonly columns, applies defaults", () => {
  const db = freshDb();
  const r = validateInsert(db, "users", {
    name: "Carol",
    user_id: 999, // readonly, ignored
    created_at: "hack", // readonly, ignored
    bogus: "nope", // unknown, ignored
  });
  assert.ok(!r.status, "no validation error");
  assert.equal(r.data.name, "Carol");
  assert.equal(r.data.user_id, undefined);
  assert.equal(r.data.bogus, undefined);
  assert.match(r.data.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(r.data.status, "ACTIVE");
});

test("validateInsert rejects duplicate (case-insensitive) unique values with 409", () => {
  const db = freshDb();
  const first = validateInsert(db, "projects", {
    project_number: "MO-2000",
    name: "P1",
  });
  db.prepare(
    "INSERT INTO projects (project_number, name, status, created_at) VALUES (?,?,?,?)"
  ).run(first.data.project_number, first.data.name, first.data.status, first.data.created_at);

  const dup = validateInsert(db, "projects", {
    project_number: "mo-2000", // different case
    name: "P2",
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.field, "project_number");
});

test("validateInsert enforces enum values", () => {
  const db = freshDb();
  const r = validateInsert(db, "projects", {
    project_number: "MO-3",
    name: "P",
    status: "MAYBE",
  });
  assert.equal(r.status, 422);
  assert.equal(r.field, "status");
});

test("validateInsert enforces quantity > 0 for checkouts and valid FKs", () => {
  const db = freshDb();
  const { userId, projectId, itemId } = seedRefs(db);

  // quantity must be > 0
  const zero = validateInsert(db, "checkouts", {
    user_id: userId,
    project_id: projectId,
    item_id: itemId,
    quantity: 0,
  });
  assert.equal(zero.status, 422);
  assert.equal(zero.field, "quantity");

  // bad FK
  const badFk = validateInsert(db, "checkouts", {
    user_id: 99999,
    project_id: projectId,
    item_id: itemId,
    quantity: 5,
  });
  assert.equal(badFk.status, 422);
  assert.equal(badFk.field, "user_id");

  // valid -> server timestamp applied, client value ignored
  const ok = validateInsert(db, "checkouts", {
    user_id: userId,
    project_id: projectId,
    item_id: itemId,
    quantity: 12,
    timestamp: "1999-01-01 00:00:00", // readonly, ignored
  });
  assert.ok(!ok.status);
  assert.equal(ok.data.quantity, 12);
  assert.notEqual(ok.data.timestamp, "1999-01-01 00:00:00");
  assert.match(ok.data.timestamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("validateInsert validates email format for report_recipients", () => {
  const db = freshDb();
  assert.equal(validateInsert(db, "report_recipients", { email: "nope" }).status, 422);
  assert.ok(!validateInsert(db, "report_recipients", { email: "a@b.co" }).status);
});

test("weekly_report_status is not writable via the generic API", () => {
  const db = freshDb();
  assert.equal(validateInsert(db, "weekly_report_status", {}).status, 403);
});

test("validateUpdate allows partial updates and re-checks uniqueness excluding self", () => {
  const db = freshDb();
  const a = db.prepare("INSERT INTO users (name) VALUES (?)").run("Ann").lastInsertRowid;
  db.prepare("INSERT INTO users (name) VALUES (?)").run("Ben");

  // renaming Ann -> "ben" collides
  const collide = validateUpdate(db, "users", a, { name: "ben" });
  assert.equal(collide.status, 409);

  // updating Ann's own row to a case variant of her own name is fine
  const ok = validateUpdate(db, "users", a, { name: "ANN" });
  assert.ok(!ok.status);
  assert.equal(ok.data.name, "ANN");
});

test("nowLocalSql formats as YYYY-MM-DD HH:MM:SS", () => {
  assert.match(nowLocalSql(new Date(2026, 0, 2, 3, 4, 5)), /^2026-01-02 03:04:05$/);
});
