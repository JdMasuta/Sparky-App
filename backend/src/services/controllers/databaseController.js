// src/controllers/cableDataController.js
import { getDatabase } from "../../init/db.init.js";
import {
  isKnownTable,
  getTable,
  getPrimaryKey,
  validateInsert,
  validateUpdate,
} from "../db/tableRegistry.js";

// Method: Get the latest n checkouts
export const getLatestCheckouts = (req, res) => {
  const { n } = req.params;

  if (!n || isNaN(n)) {
    return res
      .status(400)
      .send("Path parameter n is required and must be a number");
  }

  try {
    const db = getDatabase();
    const rows = db
      .prepare(
        `
      SELECT 
        checkout_id,
        user_id,
        project_id,
        item_id,
        quantity,
        strftime('%Y-%m-%d %H:%M:%S', timestamp) as timestamp
      FROM checkouts 
      ORDER BY timestamp DESC 
      LIMIT ?`
      )
      .all(parseInt(n));

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).send(error.message);
  }
};

// Method: Generate checkout report by timestamp range
export const generateCheckoutReport = (req, res) => {
  const { startDate, endDate } = req.body;

  // Validate input
  if (!startDate || !endDate) {
    return res.status(400).send("Both start and stop timestamps are required");
  }

  try {
    const db = getDatabase();

    // Query to fetch data between the specified timestamps
    const rows = db
      .prepare(
        `
      SELECT 
        p.project_number,
        i.sku AS item_sku,
        i.name AS item_name,
        SUM(c.quantity) AS total_quantity
      FROM 
        checkouts c
      JOIN 
        projects p ON c.project_id = p.project_id
      JOIN 
        items i ON c.item_id = i.item_id
      WHERE 
        c.timestamp >= ? AND c.timestamp <= ?
      GROUP BY 
        p.project_number, i.sku, i.name
      ORDER BY 
        p.project_number, i.sku, i.name`
      )
      .all(startDate, endDate); // Pass both timestamps as parameters

    // Handle case where no data is found
    if (rows.length === 0) {
      return res
        .status(404)
        .send("No data found for the specified time period");
    }

    // Return the report data
    res.status(200).json({
      startDate: startDate,
      endDate: endDate,
      total_records: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("Error generating report:", error);
    res.status(500).send("Internal Server Error");
  }
};

// Method: Get table data
export const getTableData = (req, res) => {
  try {
    const db = getDatabase();
    const users = db.prepare("SELECT user_id, name FROM users").all();
    const projects = db
      .prepare("SELECT project_id, project_number FROM projects")
      .all();
    const items = db.prepare("SELECT item_id, sku FROM items").all();

    res.status(200).json({
      users,
      projects,
      items,
    });
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).send("Internal Server Error");
  }
};

export const getActiveTableData = (req, res) => {
  try {
    const db = getDatabase();
    // COALESCE keeps this safe even if a DB somehow lacks the status column
    // value; the migration guarantees the column exists with default 'ACTIVE'.
    const users = db
      .prepare(
        "SELECT user_id, name FROM users WHERE COALESCE(status, 'ACTIVE') = 'ACTIVE' ORDER BY name"
      )
      .all();
    const projects = db
      .prepare(
        "SELECT project_id, project_number FROM projects WHERE COALESCE(status, 'ACTIVE') = 'ACTIVE' ORDER BY project_number"
      )
      .all();
    const items = db.prepare("SELECT item_id, sku FROM items ORDER BY sku").all();

    res.status(200).json({
      users,
      projects,
      items,
    });
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).send("Internal Server Error");
  }
};

// Method: Delete invalid checkouts
export const deleteInvalidCheckouts = (req, res) => {
  try {
    const db = getDatabase();
    const result = db
      .prepare("DELETE FROM checkouts WHERE quantity = '0'")
      .run();

    res.status(200).json({
      message: "Invalid checkouts deleted",
      affectedRows: result.changes,
    });
  } catch (error) {
    console.error("Error deleting invalid checkouts:", error);
    res.status(500).send("Internal Server Error");
  }
};

// Method: Get latest checkouts with all related data
export const getLatestCheckoutsWithDetails = (req, res) => {
  const { n } = req.params;

  if (!n || isNaN(n)) {
    return res
      .status(400)
      .send("Path parameter n is required and must be a number");
  }

  try {
    const db = getDatabase();
    const rows = db
      .prepare(
        `
      SELECT 
        c.checkout_id,
        c.quantity,
        strftime('%Y-%m-%d %H:%M:%S', c.timestamp) as timestamp,
        u.user_id,
        u.name as user_name,
        p.project_id,
        p.project_number as mo_num,
        i.item_id,
        i.name as item_name,
        i.sku as item_sku
      FROM checkouts c
      JOIN users u ON c.user_id = u.user_id
      JOIN projects p ON c.project_id = p.project_id
      JOIN items i ON c.item_id = i.item_id
      ORDER BY c.timestamp DESC 
      LIMIT ?
    `
      )
      .all(parseInt(n));

    const formattedRows = rows.map((row) => ({
      checkout_id: row.checkout_id,
      quantity: row.quantity,
      timestamp: row.timestamp,
      user: {
        id: row.user_id,
        name: row.user_name,
      },
      project: {
        id: row.project_id,
        mo_num: row.mo_num,
      },
      item: {
        id: row.item_id,
        name: row.item_name,
        sku: row.item_sku,
      },
    }));

    res.status(200).json(formattedRows);
  } catch (error) {
    console.error("Error fetching checkouts with details:", error);
    res.status(500).send("Internal Server Error");
  }
};

// Method: Get checkout statistics (today and week counts)
export const getCheckoutStats = (req, res) => {
  console.log("Getting checkout stats");
  try {
    const db = getDatabase();

    // Get today's start timestamp
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.toISOString().slice(0, 19).replace("T", " ");

    // Get week ago timestamp
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoTimestamp = weekAgo
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");

    // Single query to get both counts
    const stats = db
      .prepare(
        `
      SELECT 
        SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) as today_count,
        SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) as week_count
      FROM checkouts
    `
      )
      .get(todayTimestamp, weekAgoTimestamp);

    res.status(200).json({
      today_count: stats.today_count || 0,
      week_count: stats.week_count || 0,
    });
  } catch (error) {
    console.error("Error fetching checkout stats:", error);
    res.status(500).send("Internal Server Error");
  }
};

// Method: Get checkouts after timestamp with details
export const getCheckoutsAfterTimestampWithDetails = (req, res) => {
  const { timestamp } = req.body;

  if (!timestamp) {
    return res.status(400).send("Timestamp parameter is required");
  }

  try {
    const db = getDatabase();
    const rows = db
      .prepare(
        `
      SELECT 
        c.checkout_id,
        c.quantity,
        strftime('%Y-%m-%d %H:%M:%S', c.timestamp) as timestamp,
        u.user_id,
        u.name as user_name,
        p.project_id,
        p.project_number as mo_num,
        i.item_id,
        i.name as item_name,
        i.sku as item_sku
      FROM checkouts c
      JOIN users u ON c.user_id = u.user_id
      JOIN projects p ON c.project_id = p.project_id
      JOIN items i ON c.item_id = i.item_id
      WHERE c.timestamp >= ?
      ORDER BY c.timestamp DESC
    `
      )
      .all(timestamp);

    const formattedRows = rows.map((row) => ({
      checkout_id: row.checkout_id,
      quantity: row.quantity,
      timestamp: row.timestamp,
      user: {
        id: row.user_id,
        name: row.user_name,
      },
      project: {
        id: row.project_id,
        mo_num: row.mo_num,
      },
      item: {
        id: row.item_id,
        name: row.item_name,
        sku: row.item_sku,
      },
    }));

    res.status(200).json(formattedRows);
  } catch (error) {
    console.error("Error fetching checkouts with details:", error);
    res.status(500).send("Internal Server Error");
  }
};

// Get all checkouts after a certain timestamp
export const getCheckoutsAfterTimestamp = (req, res) => {
  const { timestamp } = req.body;

  if (!timestamp) {
    return res.status(400).send("Timestamp json parameter is required");
  }

  try {
    const db = getDatabase();
    const rows = db
      .prepare(
        `
        SELECT 
          checkout_id,
          user_id,
          project_id,
          item_id,
          quantity,
          strftime('%Y-%m-%d %H:%M:%S', timestamp) as timestamp 
        FROM checkouts 
        WHERE timestamp >= ?`
      )
      .all(timestamp);

    res.status(200).send(rows);
  } catch (error) {
    console.error("Error fetching checkouts:", error);
    res.status(500).send("Internal Server Error");
  }
};

// General CRUD Operations for All Tables
//
// Table and column identifiers are always validated against tableRegistry
// before being placed in SQL (only registry-known tables/columns can reach a
// query), and write payloads are validated for required fields, types, ranges,
// uniqueness, and foreign keys. This closes the previous identifier-injection
// hole and rejects duplicates/bad references with clean 4xx responses.

// Get all rows from a table
export const getAllData = (req, res) => {
  const { table } = req.params;

  if (!isKnownTable(table)) {
    return res.status(404).json({ error: `Unknown table '${table}'` });
  }

  try {
    const db = getDatabase();
    const pk = getPrimaryKey(table);
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${pk}`).all();
    res.status(200).json(rows);
  } catch (error) {
    console.error(`Error fetching data from table ${table}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get a single row by ID
export const getById = (req, res) => {
  const { table, id } = req.params;

  if (!isKnownTable(table)) {
    return res.status(404).json({ error: `Unknown table '${table}'` });
  }

  try {
    const db = getDatabase();
    const pk = getPrimaryKey(table);
    const row = db.prepare(`SELECT * FROM ${table} WHERE ${pk} = ?`).get(id);

    if (!row) {
      return res.status(404).json({ error: "Record not found" });
    }
    res.status(200).json(row);
  } catch (error) {
    console.error(
      `Error fetching record from table ${table} with ID ${id}:`,
      error
    );
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Create a new entry
export const createEntry = (req, res) => {
  const { table } = req.params;

  if (!isKnownTable(table)) {
    return res.status(404).json({ error: `Unknown table '${table}'` });
  }

  try {
    const db = getDatabase();
    const result = validateInsert(db, table, req.body ?? {});
    if (result.status) {
      return res
        .status(result.status)
        .json({ error: result.message, field: result.field });
    }

    const { data } = result;
    const cols = Object.keys(data);
    const placeholders = cols.map(() => "?").join(", ");
    const values = cols.map((c) => data[c]);

    const info = db
      .prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`)
      .run(...values);

    // Return the persisted row: it carries server-applied defaults (created_at,
    // status) that the client cannot reconstruct from its own payload.
    const pk = getPrimaryKey(table);
    const row = db
      .prepare(`SELECT * FROM ${table} WHERE ${pk} = ?`)
      .get(info.lastInsertRowid);

    res.status(201).json({ id: info.lastInsertRowid, row });
  } catch (error) {
    console.error(`Error creating entry in table ${table}:`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Update an entry by ID
export const updateEntry = (req, res) => {
  const { table, id } = req.params;

  if (!isKnownTable(table)) {
    return res.status(404).json({ error: `Unknown table '${table}'` });
  }

  try {
    const db = getDatabase();
    const result = validateUpdate(db, table, id, req.body ?? {});
    if (result.status) {
      return res
        .status(result.status)
        .json({ error: result.message, field: result.field });
    }

    const { data } = result;
    const pk = getPrimaryKey(table);
    const assignments = Object.keys(data)
      .map((c) => `${c} = ?`)
      .join(", ");
    const values = [...Object.keys(data).map((c) => data[c]), id];

    const info = db
      .prepare(`UPDATE ${table} SET ${assignments} WHERE ${pk} = ?`)
      .run(...values);

    if (info.changes === 0) {
      return res.status(404).json({ error: "Record not found" });
    }

    const row = db.prepare(`SELECT * FROM ${table} WHERE ${pk} = ?`).get(id);
    res.status(200).json({ message: "Update successful", row });
  } catch (error) {
    console.error(
      `Error updating entry in table ${table} with ID ${id}:`,
      error
    );
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Delete an entry by ID
export const deleteEntry = (req, res) => {
  const { table, id } = req.params;

  if (!isKnownTable(table)) {
    return res.status(404).json({ error: `Unknown table '${table}'` });
  }
  if (!getTable(table).writable) {
    return res.status(403).json({ error: `Table '${table}' is read-only` });
  }

  try {
    const db = getDatabase();
    const pk = getPrimaryKey(table);
    const info = db.prepare(`DELETE FROM ${table} WHERE ${pk} = ?`).run(id);

    if (info.changes === 0) {
      return res.status(404).json({ error: "Record not found" });
    }

    res.status(200).json({ message: "Delete successful" });
  } catch (error) {
    if (String(error.code).startsWith("SQLITE_CONSTRAINT_FOREIGNKEY")) {
      return res.status(409).json({
        error:
          "This record is referenced by existing checkouts and cannot be deleted",
      });
    }
    console.error(
      `Error deleting entry from table ${table} with ID ${id}:`,
      error
    );
    res.status(500).json({ error: "Internal Server Error" });
  }
};
