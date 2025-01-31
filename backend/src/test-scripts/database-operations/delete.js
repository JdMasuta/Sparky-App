// Path to the SQLite database file (e.g., 'database.sqlite')
const sqliteDbPath = "../../database/dev.sqlite";

// Import the better-sqlite3 library
import sqlite3 from "better-sqlite3";

// Function to delete all entries in the users table
function deleteAllUsers() {
  try {
    // Connect to the SQLite database
    const db = new sqlite3(sqliteDbPath);

    // Execute the DELETE statement
    const stmt = db.prepare("DELETE FROM checkouts WHERE quantity <= 0");
    const result = stmt.run();

    // Log the number of rows deleted
    console.log(
      `Deleted ${result.changes} rows from the sqlite_sequence table.`
    );

    // Close the database connection
    db.close();
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

// Run the function
deleteAllUsers();
