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
  {
    version: 4,
    name: "adopt items drift columns (purchase_type, manufacturer_number, spec)",
    up(db) {
      // The production items table gained these columns via manual tooling.
      // Formalize them so the Admin UI and validation layer know about them.
      addColumnIfMissing(db, "items", "purchase_type", "TEXT");
      addColumnIfMissing(db, "items", "manufacturer_number", "TEXT");
      addColumnIfMissing(db, "items", "spec", "TEXT");
    },
  },
  {
    version: 5,
    name: "normalize checkouts.timestamp to space separator",
    up(db) {
      if (!tableExists(db, "checkouts")) return;
      // Historic rows use the ISO 'T' separator (old client format); newer rows
      // use 'YYYY-MM-DD HH:MM:SS'. Normalize to the space form so lexicographic
      // BETWEEN range queries (weekly report, stats) stay correct across both.
      db.prepare(
        `UPDATE checkouts SET timestamp = REPLACE(timestamp, 'T', ' ')
           WHERE timestamp LIKE '____-__-__T%'`,
      ).run();
    },
  },
  {
    version: 6,
    name: "derive projects.created_at from 'Added M/D/YY' in description",
    up(db) {
      if (!tableExists(db, "projects")) return;
      if (!columnNames(db, "projects").includes("created_at")) return;
      const rows = db
        .prepare("SELECT project_id, description FROM projects WHERE description IS NOT NULL")
        .all();
      const update = db.prepare(
        "UPDATE projects SET created_at = ? WHERE project_id = ?",
      );
      for (const { project_id, description } of rows) {
        const iso = parseAddedDate(description);
        if (iso) update.run(iso, project_id);
      }
    },
  },
];

// Parse "Added M/D/YY" or "Added M/D/YYYY" from a project description into a
// "YYYY-MM-DD 00:00:00" string. Returns null when no date is present.
export function parseAddedDate(description) {
  const m = /Added\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i.exec(String(description || ""));
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)} 00:00:00`;
}

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
