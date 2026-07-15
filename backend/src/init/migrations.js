// Tiny versioned, idempotent SQLite migration runner.
//
// Version is tracked in `PRAGMA user_version` (transactional in SQLite, so each
// migration commits atomically with its version bump). Every migration also
// introspects with `PRAGMA table_info` before altering, so it is safe to run
// against the production DB whose schema drifted via manual tooling (it may
// already have some of these columns).
//
// Adding a migration: append to `migrations` with the next integer `version`.
// Never edit or renumber an existing migration.

const columnNames = (db, table) =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

const tableExists = (db, table) =>
  !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);

// SQLite cannot ADD COLUMN with a non-constant default (CURRENT_TIMESTAMP), so
// we add the column nullable and backfill existing rows with the local time at
// migration time. New rows get their value from the app (see tableRegistry).
const addCreatedAt = (db, table) => {
  if (!tableExists(db, table)) return;
  if (columnNames(db, table).includes("created_at")) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN created_at TEXT`);
  db.prepare(
    `UPDATE ${table} SET created_at = datetime('now','localtime') WHERE created_at IS NULL`,
  ).run();
};

const addColumnIfMissing = (db, table, column, ddlType) => {
  if (!tableExists(db, table)) return;
  if (columnNames(db, table).includes(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddlType}`);
};

const migrations = [
  {
    version: 1,
    name: "add created_at to users, projects, items",
    up(db) {
      addCreatedAt(db, "users");
      addCreatedAt(db, "projects");
      addCreatedAt(db, "items");
    },
  },
  {
    version: 2,
    name: "formalize drift columns: status (users, projects), a_number (projects)",
    up(db) {
      // status: constant default is allowed by ADD COLUMN. The ACTIVE/INACTIVE
      // check is enforced in the app validation layer (adding a CHECK to an
      // existing table would require a full table rebuild — riskier on the
      // production DB than an app-level guard).
      addColumnIfMissing(db, "users", "status", "TEXT NOT NULL DEFAULT 'ACTIVE'");
      addColumnIfMissing(db, "projects", "status", "TEXT NOT NULL DEFAULT 'ACTIVE'");
      addColumnIfMissing(db, "projects", "a_number", "TEXT");
    },
  },
  {
    version: 3,
    name: "case-insensitive unique index on users.name",
    up(db, warn) {
      if (!tableExists(db, "users")) return;
      const dups = db
        .prepare(
          `SELECT name, COUNT(*) AS c FROM users
             GROUP BY name COLLATE NOCASE HAVING c > 1`,
        )
        .all();
      if (dups.length > 0) {
        warn(
          `users.name has ${dups.length} duplicate value(s) ` +
            `(${dups.map((d) => `"${d.name}"`).join(", ")}); ` +
            `skipping unique index. Resolve duplicates in the Admin Dashboard.`,
        );
        return;
      }
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS ux_users_name_nocase
           ON users(name COLLATE NOCASE)`,
      );
    },
  },
];

/**
 * Run all pending migrations. Returns an array of human-readable warning
 * strings (e.g. skipped constraints) so the caller can log/surface them.
 */
export const runMigrations = (db) => {
  const current = db.pragma("user_version", { simple: true });
  const warnings = [];
  const warn = (msg) => warnings.push(msg);

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    const tx = db.transaction(() => {
      migration.up(db, warn);
      db.pragma(`user_version = ${migration.version}`);
    });
    tx();
    console.log(`Migration ${migration.version} applied: ${migration.name}`);
  }

  for (const w of warnings) console.warn(`Migration warning: ${w}`);
  return warnings;
};

export const LATEST_MIGRATION = migrations[migrations.length - 1].version;
