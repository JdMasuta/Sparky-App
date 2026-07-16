import Database from "better-sqlite3";
import { createTables } from "../src/init/db.init.js";
import { runMigrations } from "../src/init/migrations.js";

/** Build a fresh in-memory DB with the base schema (+ migrations by default). */
export function freshDb({ migrate = true } = {}) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createTables(db);
  if (migrate) runMigrations(db);
  return db;
}

/** Seed one user, project, and item; return their ids. */
export function seedRefs(db) {
  const u = db
    .prepare("INSERT INTO users (name, user_type, status) VALUES (?,?,?)")
    .run("Alice", "operator", "ACTIVE").lastInsertRowid;
  const p = db
    .prepare(
      "INSERT INTO projects (project_number, name, status) VALUES (?,?,?)"
    )
    .run("MO-1001", "Test Project", "ACTIVE").lastInsertRowid;
  const i = db
    .prepare("INSERT INTO items (sku, name) VALUES (?,?)")
    .run("SKU-1", "Test Cable").lastInsertRowid;
  return { userId: u, projectId: p, itemId: i };
}
