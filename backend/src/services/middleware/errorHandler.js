// Central Express error handler. Maps better-sqlite3 constraint errors to clean
// HTTP status codes and always sends exactly one response.
//
// Note: the generic CRUD controllers pre-validate and return 409/422 directly,
// so this is a backstop for anything that slips through (e.g. a UNIQUE
// violation under a race, or a constraint on a path that didn't pre-check).
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const code = String(err?.code ?? "");
  const message = err?.message ?? "Unknown error";

  // better-sqlite3 surfaces SQLite constraint failures as SQLITE_CONSTRAINT_*.
  if (code.startsWith("SQLITE_CONSTRAINT")) {
    if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      return res.status(409).json({
        error: "This value already exists",
        message,
      });
    }
    if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      return res.status(409).json({
        error: "Referenced record does not exist or is still in use",
        message,
      });
    }
    if (code === "SQLITE_CONSTRAINT_NOTNULL") {
      return res.status(422).json({
        error: "A required field is missing",
        message,
      });
    }
    if (code === "SQLITE_CONSTRAINT_CHECK") {
      return res.status(422).json({
        error: "A field has an invalid value",
        message,
      });
    }
    return res.status(409).json({ error: "Constraint violation", message });
  }

  // Other SQLite errors (e.g. malformed statement) — treat as bad input/server.
  if (code.startsWith("SQLITE_")) {
    console.error("SQLite error:", err.stack || message);
    return res.status(500).json({ error: "Database error", message });
  }

  console.error("Unhandled error:", err.stack || message);
  res.status(500).json({ error: "Internal Server Error", message });
};

export default errorHandler;
