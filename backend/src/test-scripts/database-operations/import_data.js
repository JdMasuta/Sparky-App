// import_data.js
import mysql from "mysql2/promise";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Database configuration variables
const mysqlConfig = {
  host: "localhost",
  user: "root",
  password: "root64",
  database: "cable_data",
};

// SQLite configuration
const sqliteConfig = {
  filename: "dev.sqlite",
  verbose: process.env.NODE_ENV === "development" ? console.log : null,
};

// Define primary keys for each table
const tablePrimaryKeys = {
  users: "user_id",
  items: "item_id",
  projects: "project_id",
  checkouts: "checkout_id",
};

// Define timestamp fields for each table
const tableTimestamps = {
  users: [],
  items: [],
  projects: [],
  checkouts: ["timestamp"],
};

// Debug flag
const debug = true;

// Function to get table columns from MySQL
async function getTableColumns(connection, table) {
  try {
    const [rows] = await connection.execute(`SHOW COLUMNS FROM \`${table}\``);
    return rows.map((row) => row.Field);
  } catch (error) {
    console.error(`Error getting columns for table ${table}:`, error);
    throw error;
  }
}

// Function to fetch data from MySQL with formatted timestamps
async function fetchDataFromMySQL(connection, table) {
  try {
    let selectColumns = "*";
    if (table in tableTimestamps && tableTimestamps[table].length > 0) {
      const columns = await getTableColumns(connection, table);
      selectColumns = columns
        .map((column) => {
          if (tableTimestamps[table].includes(column)) {
            return `DATE_FORMAT(${column}, '%Y-%m-%d %H:%i:%s') AS ${column}`;
          }
          return `\`${column}\``;
        })
        .join(", ");
    }

    const [rows] = await connection.execute(
      `SELECT ${selectColumns} FROM \`${table}\``
    );
    if (debug) {
      console.log(`Fetched ${rows.length} rows from MySQL table ${table}`);
    }
    return rows;
  } catch (error) {
    console.error(`Error fetching data from table ${table}:`, error);
    throw error;
  }
}

// Function to sanitize data for SQLite
function sanitizeData(data, table) {
  return data.map((row) => {
    const sanitizedRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (value instanceof Date) {
        sanitizedRow[key] = value.toISOString().slice(0, 19).replace("T", " ");
      } else if (value === undefined || value === null) {
        sanitizedRow[key] = null;
      } else {
        sanitizedRow[key] = value;
      }
    }
    return sanitizedRow;
  });
}

// Function to fetch existing primary keys from SQLite
function getExistingIDs(db, table) {
  try {
    const primaryKey = tablePrimaryKeys[table];
    const stmt = db.prepare(`SELECT ${primaryKey} FROM ${table}`);
    const rows = stmt.all();
    const existingIds = new Set(rows.map((row) => row[primaryKey]));

    if (debug) {
      console.log(
        `Found ${existingIds.size} existing records in SQLite table ${table}`
      );
    }

    return existingIds;
  } catch (error) {
    console.error(`Error fetching existing IDs from table ${table}:`, error);
    throw error;
  }
}

// Function to insert data into SQLite using transactions
function insertDataIntoSQLite(db, table, data, existingIDs) {
  if (!data?.length) {
    console.log(`No data to insert for table ${table}`);
    return;
  }

  try {
    const sanitizedData = sanitizeData(data, table);
    const primaryKey = tablePrimaryKeys[table];
    const filteredData = sanitizedData.filter(
      (row) => !existingIDs.has(row[primaryKey])
    );

    if (!filteredData.length) {
      console.log(`No new records to insert for table ${table}`);
      return;
    }

    const columns = Object.keys(filteredData[0]);
    const placeholders = columns.map(() => "?").join(", ");
    const insertSQL = `INSERT INTO ${table} (${columns.join(
      ", "
    )}) VALUES (${placeholders})`;

    if (debug) {
      console.log(
        `Preparing to insert ${filteredData.length} records into ${table}`
      );
    }

    // Prepare statement and create transaction
    const insertStmt = db.prepare(insertSQL);
    const transaction = db.transaction((rows) => {
      for (const row of rows) {
        const values = columns.map((col) => row[col]);
        insertStmt.run(values);
      }
    });

    // Execute transaction
    transaction(filteredData);

    console.log(
      `Successfully inserted ${filteredData.length} new records into ${table}`
    );
  } catch (error) {
    console.error(`Error inserting data into table ${table}:`, error);
    throw error;
  }
}

// Main function
async function main() {
  let mysqlConnection = null;
  let sqliteDb = null;

  try {
    // Connect to MySQL
    console.log("Connecting to MySQL database...");
    mysqlConnection = await mysql.createConnection(mysqlConfig);

    // Connect to SQLite
    console.log("Connecting to SQLite database...");
    sqliteDb = new Database(sqliteConfig.filename, {
      verbose: sqliteConfig.verbose,
    });

    // Temporarily disable foreign keys for import
    sqliteDb.pragma("foreign_keys = OFF");

    // List of tables to transfer in the correct order
    const tables = ["users", "items", "projects", "checkouts"];

    // Process each table
    for (const table of tables) {
      console.log(`\nProcessing table: ${table}`);
      const existingIDs = getExistingIDs(sqliteDb, table);
      const data = await fetchDataFromMySQL(mysqlConnection, table);
      await insertDataIntoSQLite(sqliteDb, table, data, existingIDs);
    }

    // Re-enable foreign keys
    sqliteDb.pragma("foreign_keys = ON");

    console.log("\nData transfer completed successfully.");
  } catch (error) {
    console.error("\nFatal error during data transfer:", error);
    process.exit(1);
  } finally {
    // Clean up connections
    if (mysqlConnection) {
      console.log("Closing MySQL connection...");
      await mysqlConnection.end();
    }
    if (sqliteDb) {
      console.log("Closing SQLite connection...");
      sqliteDb.close();
    }
  }
}

// Run the main function
main();
