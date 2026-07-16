import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { serverConfig } from "../services/config/server.config.js";
import { runMigrations } from "./migrations.js";

let config;
try {
  const importedConfig = await import("../services/config/db.config.js");
  config = importedConfig.default;
  if (config == undefined) {
    config = {
      filename: path.join(serverConfig.paths.database, "dev.sqlite"),
      maxConnections: 10,
      timeout: 5000,
      verbose: false,
    };
  }
  console.log("Loaded config:", config);
} catch (error) {
  console.error("Error importing config:", error);
  throw new Error(`Failed to import database config: ${error.message}`);
}

let db = null;

const REQUIRED_TABLES = ["users", "projects", "items", "checkouts", "report_recipients", "weekly_report_status"];

const tableExists = (db, tableName) => {
  try {
    const result = db
      .prepare(
        `
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name=?
    `
      )
      .get(tableName);
    return !!result;
  } catch (error) {
    console.error(
      `Error checking existence of table ${tableName}:`,
      error.message
    );
    throw new Error(`Failed to verify table ${tableName}: ${error.message}`);
  }
};

export const createTables = (db) => {
  try {
    const missingTables = REQUIRED_TABLES.filter(
      (table) => !tableExists(db, table)
    );

    if (missingTables.length === 0) {
      return;
    }

    // Create users table if needed
    if (missingTables.includes("users")) {
      try {
        db.exec(`
          CREATE TABLE users (
            user_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR(100) DEFAULT 'USER',
            user_type VARCHAR(255) DEFAULT NULL
          );
        `);
      } catch (error) {
        console.error("Error creating users table:", error.message);
        throw new Error(`Failed to create users table: ${error.message}`);
      }
    }

    // Create projects table if needed
    if (missingTables.includes("projects")) {
      try {
        db.exec(`
          CREATE TABLE projects (
            project_id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_number VARCHAR(50) NOT NULL UNIQUE,
            name VARCHAR(100) NOT NULL DEFAULT 'auto-insert',
            description TEXT DEFAULT NULL
          );
        `);
      } catch (error) {
        console.error("Error creating projects table:", error.message);
        throw new Error(`Failed to create projects table: ${error.message}`);
      }
    }

    // Create items table if needed
    if (missingTables.includes("items")) {
      try {
        db.exec(`
          CREATE TABLE items (
            item_id INTEGER PRIMARY KEY AUTOINCREMENT,
            sku VARCHAR(50) NOT NULL UNIQUE,
            name VARCHAR(100) NOT NULL,
            description TEXT DEFAULT NULL,
            quantity_in_stock INTEGER DEFAULT 0
          );
        `);
      } catch (error) {
        console.error("Error creating items table:", error.message);
        throw new Error(`Failed to create items table: ${error.message}`);
      }
    }

    // Create checkouts table if needed
    if (missingTables.includes("checkouts")) {
      try {
        db.exec(`
          CREATE TABLE checkouts (
            checkout_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            project_id INTEGER,
            item_id INTEGER,
            quantity INTEGER NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(user_id),
            FOREIGN KEY (project_id) REFERENCES projects(project_id),
            FOREIGN KEY (item_id) REFERENCES items(item_id)
          );
        `);
      } catch (error) {
        console.error("Error creating checkouts table:", error.message);
        throw new Error(`Failed to create checkouts table: ${error.message}`);
      }
    }

    // Create report_recipients table if needed
    if (missingTables.includes("report_recipients")) {
      try {
        db.exec(`
          CREATE TABLE report_recipients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE
          );
          INSERT INTO report_recipients (email) VALUES ('ruben.lara@bwpackaging.com');
          INSERT INTO report_recipients (email) VALUES ('DLBWIS-LOV.Warehouse19@bwpackagingsystems.com');
        `);
      } catch (error) {
        console.error("Error creating report_recipients table:", error.message);
        throw new Error(`Failed to create report_recipients table: ${error.message}`);
      }
    }

    // Create weekly_report_status table if needed
    if (missingTables.includes("weekly_report_status")) {
      try {
        db.exec(`
          CREATE TABLE weekly_report_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ran_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            success INTEGER NOT NULL,
            error_message TEXT DEFAULT NULL
          );
        `);
      } catch (error) {
        console.error("Error creating weekly_report_status table:", error.message);
        throw new Error(`Failed to create weekly_report_status table: ${error.message}`);
      }
    }
  } catch (error) {
    console.error("Error in createTables:", error.message);
    throw new Error(`Table creation failed: ${error.message}`);
  }
};

// One-time relocation: if the DB lives at the legacy in-tree path and not yet
// at the (production) data dir, copy it over so we don't start from an empty DB
// after moving SPARKY_DATA_DIR outside the release tree. Runs only when the two
// paths differ (i.e. SPARKY_DATA_DIR is set to a non-legacy location).
const relocateLegacyDatabaseIfNeeded = () => {
  const legacyPath = path.join(
    serverConfig.paths.legacyDatabase,
    path.basename(config.filename)
  );
  if (
    legacyPath !== config.filename &&
    !fs.existsSync(config.filename) &&
    fs.existsSync(legacyPath)
  ) {
    fs.copyFileSync(legacyPath, config.filename);
    console.log(
      `Relocated database from legacy path ${legacyPath} to ${config.filename}`
    );
  }

  // First production boot: the legacy stack ran as NODE_ENV=development, so the
  // live data lives in dev.sqlite. If we're now starting in production and no
  // prod.sqlite exists yet but a dev.sqlite is present in the same data dir,
  // adopt (copy) it once so we don't start from an empty DB.
  if (
    path.basename(config.filename) === "prod.sqlite" &&
    !fs.existsSync(config.filename)
  ) {
    const devPath = path.join(path.dirname(config.filename), "dev.sqlite");
    if (fs.existsSync(devPath)) {
      fs.copyFileSync(devPath, config.filename);
      console.warn(
        `NOTICE: no prod.sqlite found; adopted existing dev.sqlite as ${config.filename}. ` +
          `Remove/rename dev.sqlite once you've confirmed the production DB is correct.`
      );
    }
  }
};

export const initializeDatabase = () => {
  try {
    const dbDir = path.dirname(config.filename);
    if (!fs.existsSync(dbDir)) {
      try {
        fs.mkdirSync(dbDir, { recursive: true });
      } catch (error) {
        console.error("Error creating database directory:", error.message);
        throw new Error(
          `Failed to create database directory: ${error.message}`
        );
      }
    }

    relocateLegacyDatabaseIfNeeded();

    db = new Database(config.filename, {
      verbose: config.verbose ? console.log : null,
      timeout: config.timeout,
    });

    try {
      db.pragma("foreign_keys = ON");
    } catch (error) {
      console.error("Error enabling foreign keys:", error.message);
      throw new Error(`Failed to enable foreign keys: ${error.message}`);
    }

    createTables(db);
    migrationWarnings = runMigrations(db);
    return db;
  } catch (error) {
    console.error("Database initialization failed:", error.message);
    if (db) {
      try {
        db.close();
        db = null;
      } catch (closeError) {
        console.error(
          "Error while closing database after initialization failure:",
          closeError.message
        );
      }
    }
    throw error;
  }
};

export const getDatabase = () => {
  if (!db) {
    console.error("Attempted to get database before initialization");
    throw new Error(
      "Database not initialized. Call initializeDatabase() first."
    );
  }
  return db;
};

// Warnings from the last migration run (e.g. skipped constraints on drifted
// data), surfaced by the Admin Dashboard via /api/system/info.
let migrationWarnings = [];
export const getMigrationWarnings = () => migrationWarnings;

export const closeDatabase = () => {
  if (db) {
    try {
      db.close();
      db = null;
      console.log("Database connection closed");
    } catch (error) {
      console.error("Error closing database connection:", error.message);
      throw new Error(`Failed to close database connection: ${error.message}`);
    }
  }
};
