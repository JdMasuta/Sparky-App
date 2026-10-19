import { test } from "node:test";
import assert from "node:assert/strict";
import { expireInactiveProjects } from "../src/services/db/projectExpiry.js";
import { freshDb, seedRefs } from "./helpers.js";

const daysAgo = (n) =>
  new Date(Date.now() - n * 864e5).toISOString().slice(0, 19).replace("T", " ");

function addProject(db, number, createdAt) {
  return db
    .prepare("INSERT INTO projects (project_number, name, status, created_at) VALUES (?,?,?,?)")
    .run(number, number, "ACTIVE", createdAt).lastInsertRowid;
}
function checkout(db, ids, projectId, ts) {
  db.prepare(
    "INSERT INTO checkouts (user_id, project_id, item_id, quantity, timestamp) VALUES (?,?,?,?,?)"
  ).run(ids.userId, projectId, ids.itemId, 1, ts);
}
const status = (db, id) =>
  db.prepare("SELECT status FROM projects WHERE project_id = ?").get(id).status;

test("expires projects whose latest checkout is over two months old", () => {
  const db = freshDb();
  const ids = seedRefs(db);
  const stale = addProject(db, "STALE", daysAgo(300));
  const recent = addProject(db, "RECENT", daysAgo(300));
  checkout(db, ids, stale, daysAgo(90));
  checkout(db, ids, recent, daysAgo(90));
  checkout(db, ids, recent, daysAgo(5)); // latest checkout is what counts
  assert.equal(expireInactiveProjects(db), 1);
  assert.equal(status(db, stale), "INACTIVE");
  assert.equal(status(db, recent), "ACTIVE");
});

test("projects without checkouts are measured from created_at", () => {
  const db = freshDb();
  const oldP = addProject(db, "OLD", daysAgo(90));
  const newP = addProject(db, "NEW", daysAgo(10));
  expireInactiveProjects(db);
  assert.equal(status(db, oldP), "INACTIVE");
  assert.equal(status(db, newP), "ACTIVE");
});

test("already-INACTIVE projects are left alone", () => {
  const db = freshDb();
  addProject(db, "X", daysAgo(90));
  expireInactiveProjects(db);
  assert.equal(expireInactiveProjects(db), 0);
});
