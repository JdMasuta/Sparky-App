// Multi-line checkout (#17): insert several checkout rows in one transaction so
// a submission is all-or-nothing. Each row goes through the same validation as
// a single POST /api/checkouts (FKs, quantity > 0, server timestamp).
import { validateInsert } from "./tableRegistry.js";

export const MAX_BATCH_SIZE = 50;

/**
 * @param {import("better-sqlite3").Database} db
 * @param {unknown} rows array of { user_id, project_id, item_id, quantity }
 * @returns {{ rows: object[] } | { status: number, message: string, field?: string, index?: number }}
 */
export function insertCheckoutBatch(db, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: 422, field: "rows", message: "rows must be a non-empty array" };
  }
  if (rows.length > MAX_BATCH_SIZE) {
    return {
      status: 422,
      field: "rows",
      message: `A checkout can have at most ${MAX_BATCH_SIZE} lines`,
    };
  }

  // Validate everything before writing anything.
  const validated = [];
  for (const [index, row] of rows.entries()) {
    const result = validateInsert(db, "checkouts", row ?? {});
    if (result.status) {
      return {
        status: result.status,
        field: result.field,
        message: `Line ${index + 1}: ${result.message}`,
        index,
      };
    }
    validated.push(result.data);
  }

  const insertAll = db.transaction((items) =>
    items.map((data) => {
      const cols = Object.keys(data);
      const info = db
        .prepare(
          `INSERT INTO checkouts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
        )
        .run(...cols.map((c) => data[c]));
      return db
        .prepare("SELECT * FROM checkouts WHERE checkout_id = ?")
        .get(info.lastInsertRowid);
    })
  );

  return { rows: insertAll(validated) };
}
