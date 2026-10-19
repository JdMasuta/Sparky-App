import { test } from "node:test";
import assert from "node:assert/strict";
import { insertCheckoutBatch, MAX_BATCH_SIZE } from "../src/services/db/checkoutBatch.js";
import { freshDb, seedRefs } from "./helpers.js";

const count = (db) => db.prepare("SELECT COUNT(*) AS n FROM checkouts").get().n;

function secondItem(db) {
  return db
    .prepare("INSERT INTO items (sku, name) VALUES (?,?)")
    .run("SKU-2", "Other Cable").lastInsertRowid;
}

test("inserts every line and returns the persisted rows", () => {
  const db = freshDb();
  const { userId, projectId, itemId } = seedRefs(db);
  const item2 = secondItem(db);
  const result = insertCheckoutBatch(db, [
    { user_id: userId, project_id: projectId, item_id: itemId, quantity: 12.5 },
    { user_id: userId, project_id: projectId, item_id: item2, quantity: 3 },
    // Duplicate SKUs are allowed (two cuts of the same cable).
    { user_id: userId, project_id: projectId, item_id: itemId, quantity: 7 },
  ]);
  assert.equal(result.status, undefined);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(
    result.rows.map((r) => r.quantity),
    [12.5, 3, 7]
  );
  assert.ok(result.rows.every((r) => r.timestamp), "server timestamp applied");
  assert.equal(count(db), 3);
});

test("one invalid line rejects the whole batch", () => {
  const db = freshDb();
  const { userId, projectId, itemId } = seedRefs(db);
  const result = insertCheckoutBatch(db, [
    { user_id: userId, project_id: projectId, item_id: itemId, quantity: 5 },
    { user_id: userId, project_id: projectId, item_id: itemId, quantity: 0 },
  ]);
  assert.equal(result.status, 422);
  assert.equal(result.index, 1);
  assert.match(result.message, /^Line 2:/);
  assert.equal(count(db), 0);
});

test("unknown foreign keys reject the whole batch", () => {
  const db = freshDb();
  const { userId, projectId, itemId } = seedRefs(db);
  const result = insertCheckoutBatch(db, [
    { user_id: userId, project_id: projectId, item_id: itemId, quantity: 5 },
    { user_id: userId, project_id: projectId, item_id: 9999, quantity: 5 },
  ]);
  assert.equal(result.status, 422);
  assert.equal(count(db), 0);
});

test("rejects empty, non-array and oversized batches", () => {
  const db = freshDb();
  const { userId, projectId, itemId } = seedRefs(db);
  assert.equal(insertCheckoutBatch(db, []).status, 422);
  assert.equal(insertCheckoutBatch(db, undefined).status, 422);
  const row = { user_id: userId, project_id: projectId, item_id: itemId, quantity: 1 };
  const big = Array.from({ length: MAX_BATCH_SIZE + 1 }, () => ({ ...row }));
  assert.equal(insertCheckoutBatch(db, big).status, 422);
  assert.equal(count(db), 0);
});
