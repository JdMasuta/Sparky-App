// Single source of truth for the generic REST CRUD layer.
//
// Every table/column identifier that reaches SQL is validated against this
// registry, which closes the identifier-injection hole in the old generic CRUD
// (it interpolated the URL table name and arbitrary JSON keys straight into
// SQL). It also drives server-side write validation: required fields, types,
// enums, ranges, uniqueness (incl. case-insensitive), and foreign keys — so
// duplicates and bad references are rejected with clean 4xx responses instead
// of leaking DB errors or silently inserting garbage.

/** Local-time "YYYY-MM-DD HH:MM:SS", matching existing rows and the DB's
 * datetime('now','localtime'). The edge device runs in the plant's timezone. */
export const nowLocalSql = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const registry = {
  users: {
    pk: "user_id",
    writable: true,
    readonly: ["user_id", "created_at"],
    columns: {
      name: { type: "string", required: true, maxLength: 100 },
      user_type: { type: "string", required: false, maxLength: 255 },
      status: {
        type: "enum",
        values: ["ACTIVE", "INACTIVE"],
        required: false,
        default: "ACTIVE",
      },
    },
    unique: [
      { columns: ["name"], ci: true, message: "A user with this name already exists" },
    ],
    insertDefaults: () => ({ created_at: nowLocalSql(), status: "ACTIVE" }),
  },

  projects: {
    pk: "project_id",
    writable: true,
    readonly: ["project_id", "created_at"],
    columns: {
      project_number: { type: "string", required: true, maxLength: 50 },
      name: { type: "string", required: true, maxLength: 100 },
      description: { type: "string", required: false },
      a_number: { type: "string", required: false, maxLength: 50 },
      status: {
        type: "enum",
        values: ["ACTIVE", "INACTIVE"],
        required: false,
        default: "ACTIVE",
      },
    },
    unique: [
      {
        columns: ["project_number"],
        ci: true,
        message: "A project with this project number already exists",
      },
    ],
    insertDefaults: () => ({ created_at: nowLocalSql(), status: "ACTIVE" }),
  },

  items: {
    pk: "item_id",
    writable: true,
    readonly: ["item_id", "created_at"],
    columns: {
      sku: { type: "string", required: true, maxLength: 50 },
      name: { type: "string", required: true, maxLength: 100 },
      description: { type: "string", required: false },
      quantity_in_stock: { type: "integer", required: false, min: 0, default: 0 },
    },
    unique: [
      { columns: ["sku"], ci: true, message: "An item with this SKU already exists" },
    ],
    insertDefaults: () => ({ created_at: nowLocalSql() }),
  },

  checkouts: {
    pk: "checkout_id",
    writable: true,
    readonly: ["checkout_id", "timestamp"],
    columns: {
      user_id: { type: "fk", ref: "users", required: true },
      project_id: { type: "fk", ref: "projects", required: true },
      item_id: { type: "fk", ref: "items", required: true },
      quantity: { type: "number", required: true, min: 0, exclusiveMin: true },
    },
    unique: [],
    // Server-authoritative timestamp; any client-sent value is ignored.
    insertDefaults: () => ({ timestamp: nowLocalSql() }),
  },

  report_recipients: {
    pk: "id",
    writable: true,
    readonly: ["id"],
    columns: {
      email: { type: "email", required: true, maxLength: 255 },
    },
    unique: [
      { columns: ["email"], ci: true, message: "This email is already a recipient" },
    ],
    insertDefaults: () => ({}),
  },

  // Read-only from the generic API (written only by the server's cron job).
  weekly_report_status: {
    pk: "id",
    writable: false,
    readonly: ["id", "ran_at", "success", "error_message"],
    columns: {},
    unique: [],
    insertDefaults: () => ({}),
  },
};

export const isKnownTable = (table) =>
  Object.prototype.hasOwnProperty.call(registry, table);

export const getTable = (table) => registry[table];

export const getPrimaryKey = (table) => registry[table]?.pk ?? "id";

// ---- value coercion / single-field validation -----------------------------

function coerceAndValidateField(spec, rawValue) {
  // Treat empty string / null / undefined as "absent".
  const absent =
    rawValue === undefined || rawValue === null || rawValue === "";

  if (absent) {
    if (spec.required) return { error: "is required" };
    return { skip: true }; // let DB/default handle it
  }

  switch (spec.type) {
    case "string":
    case "email": {
      const v = String(rawValue).trim();
      if (v === "" && spec.required) return { error: "is required" };
      if (spec.maxLength && v.length > spec.maxLength)
        return { error: `must be at most ${spec.maxLength} characters` };
      if (spec.type === "email" && !EMAIL_RE.test(v))
        return { error: "must be a valid email address" };
      return { value: v };
    }
    case "enum": {
      const v = String(rawValue).trim();
      if (!spec.values.includes(v))
        return { error: `must be one of ${spec.values.join(", ")}` };
      return { value: v };
    }
    case "integer":
    case "number":
    case "fk": {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) return { error: "must be a number" };
      if ((spec.type === "integer" || spec.type === "fk") && !Number.isInteger(n))
        return { error: "must be a whole number" };
      if (spec.min !== undefined) {
        if (spec.exclusiveMin ? n <= spec.min : n < spec.min)
          return {
            error: `must be greater than${spec.exclusiveMin ? "" : " or equal to"} ${spec.min}`,
          };
      }
      return { value: n };
    }
    default:
      return { value: rawValue };
  }
}

// ---- uniqueness / FK checks (need a db handle) ----------------------------

function uniquenessError(db, table, def, data, excludeId) {
  const meta = registry[table];
  // Only enforce when all of the unique-set columns are present in `data`.
  if (!def.columns.every((c) => data[c] !== undefined)) return null;

  const where = def.columns
    .map((c) => (def.ci ? `${c} = ? COLLATE NOCASE` : `${c} = ?`))
    .join(" AND ");
  const params = def.columns.map((c) => data[c]);
  let sql = `SELECT ${meta.pk} AS id FROM ${table} WHERE ${where}`;
  if (excludeId !== undefined) {
    sql += ` AND ${meta.pk} <> ?`;
    params.push(excludeId);
  }
  const hit = db.prepare(sql).get(...params);
  if (hit) return { field: def.columns[0], message: def.message };
  return null;
}

function foreignKeyError(db, table, data) {
  const meta = registry[table];
  for (const [col, spec] of Object.entries(meta.columns)) {
    if (spec.type !== "fk") continue;
    if (data[col] === undefined) continue;
    const refPk = registry[spec.ref].pk;
    const exists = db
      .prepare(`SELECT 1 FROM ${spec.ref} WHERE ${refPk} = ?`)
      .get(data[col]);
    if (!exists)
      return { field: col, message: `Referenced ${spec.ref} does not exist` };
  }
  return null;
}

/**
 * Validate a create payload. Returns { data } on success (only registry-known,
 * non-readonly columns, plus insert defaults), or { status, field, message }.
 */
export function validateInsert(db, table, body) {
  const meta = registry[table];
  if (!meta) return { status: 400, message: `Unknown table '${table}'` };
  if (!meta.writable)
    return { status: 403, message: `Table '${table}' is read-only` };

  const data = {};
  const fieldErrors = {};

  for (const [col, spec] of Object.entries(meta.columns)) {
    const result = coerceAndValidateField(spec, body[col]);
    if (result.error) fieldErrors[col] = `${col} ${result.error}`;
    else if (!result.skip) data[col] = result.value;
  }

  if (Object.keys(fieldErrors).length > 0) {
    const first = Object.keys(fieldErrors)[0];
    return {
      status: 422,
      field: first,
      message: fieldErrors[first],
      fieldErrors,
    };
  }

  // Apply insert defaults for anything not supplied.
  for (const [k, v] of Object.entries(meta.insertDefaults())) {
    if (data[k] === undefined) data[k] = v;
  }

  const fk = foreignKeyError(db, table, data);
  if (fk) return { status: 422, field: fk.field, message: fk.message };

  for (const def of meta.unique) {
    const dup = uniquenessError(db, table, def, data);
    if (dup) return { status: 409, field: dup.field, message: dup.message };
  }

  return { data };
}

/**
 * Validate an update payload (partial). Returns { data } with only the changed,
 * writable, registry-known columns, or { status, field, message }.
 */
export function validateUpdate(db, table, id, body) {
  const meta = registry[table];
  if (!meta) return { status: 400, message: `Unknown table '${table}'` };
  if (!meta.writable)
    return { status: 403, message: `Table '${table}' is read-only` };

  const data = {};
  const fieldErrors = {};

  for (const [col, spec] of Object.entries(meta.columns)) {
    if (!(col in body)) continue; // partial update: only provided fields
    // Required columns cannot be blanked out on update.
    const result = coerceAndValidateField(spec, body[col]);
    if (result.error) fieldErrors[col] = `${col} ${result.error}`;
    else if (result.skip) {
      // provided but empty and optional -> allow explicit clear for nullable cols
      if (!spec.required) data[col] = null;
    } else data[col] = result.value;
  }

  if (Object.keys(fieldErrors).length > 0) {
    const first = Object.keys(fieldErrors)[0];
    return {
      status: 422,
      field: first,
      message: fieldErrors[first],
      fieldErrors,
    };
  }

  if (Object.keys(data).length === 0)
    return { status: 400, message: "No valid updatable fields provided" };

  const fk = foreignKeyError(db, table, data);
  if (fk) return { status: 422, field: fk.field, message: fk.message };

  for (const def of meta.unique) {
    const dup = uniquenessError(db, table, def, data, id);
    if (dup) return { status: 409, field: dup.field, message: dup.message };
  }

  return { data };
}
