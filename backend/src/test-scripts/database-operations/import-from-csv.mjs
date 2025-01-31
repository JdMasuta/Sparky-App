import Database from "better-sqlite3";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database connection
const db = new Database(join(__dirname, "..", "..", "database", "dev.sqlite"));

// Prepare statements for lookups
const getUserId = db.prepare("SELECT user_id FROM users WHERE name = ?");
const getProjectId = db.prepare(
  "SELECT project_id FROM projects WHERE project_number = ?"
);
const getItemId = db.prepare("SELECT item_id FROM items WHERE sku = ?");

// Prepare check for existing entry
const checkExisting = db.prepare(`
  SELECT COUNT(*) as count 
  FROM checkouts 
  WHERE user_id = @user_id 
  AND project_id = @project_id 
  AND item_id = @item_id 
  AND quantity = @quantity 
  AND timestamp = @timestamp
`);

// Prepare insert statement
const insertCheckout = db.prepare(`
  INSERT INTO checkouts (user_id, project_id, item_id, quantity, timestamp)
  VALUES (@user_id, @project_id, @item_id, @quantity, @timestamp)
`);

// Helper function to ensure uppercase
function validateString(str) {
  return str ? str.trim().toUpperCase() : "";
}

// Format timestamp to YYYY-MM-DD HH:MM:SS
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// Parse CSV string into array of objects
function parseCSV(content) {
  const lines = content.split("\n");
  const headers = lines[0].split(",").map((header) => header.trim());

  return lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => {
      const values = line.split(",").map((value) => value.trim());
      return headers.reduce((obj, header, index) => {
        // Convert string values to uppercase, leave timestamp and quantity as is
        const value = values[index];
        obj[header] = ["Timestamp", "Quantity"].includes(header)
          ? value
          : validateString(value);
        return obj;
      }, {});
    });
}

async function importData() {
  try {
    // Read CSV file
    const csvContent = await fs.readFile("data.csv", "utf-8");
    const rows = parseCSV(csvContent);

    let successCount = 0;
    let errorCount = 0;

    for (const row of rows) {
      try {
        // Validate quantity
        const quantity = parseFloat(row.Quantity);
        if (isNaN(quantity) || quantity === 0) {
          console.log(`Skipping row with invalid quantity: ${row.Quantity}`);
          errorCount++;
          continue;
        }

        // Look up IDs
        const user = getUserId.get(row.User);
        if (!user) {
          console.log(`User not found: ${row.User}`);
          errorCount++;
          continue;
        }

        const project = getProjectId.get(row["Project MO"]);
        if (!project) {
          console.log(`Project not found: ${row["Project MO"]}`);
          errorCount++;
          continue;
        }

        const item = getItemId.get(row.Item);
        if (!item) {
          console.log(`Item not found: ${row.Item}`);
          errorCount++;
          continue;
        }

        // Format timestamp
        const timestamp = formatTimestamp(row.Timestamp);

        // Check if entry already exists
        const params = {
          user_id: user.user_id,
          project_id: project.project_id,
          item_id: item.item_id,
          quantity: quantity,
          timestamp: timestamp,
        };

        // Check for existing entry
        const exists = checkExisting.get(params).count > 0;

        if (exists) {
          console.log(`Skipping duplicate entry for user ${row.User}`);
          successCount++; // Still count as success since we're handling it gracefully
        } else {
          // Insert into database
          insertCheckout.run(params);
          console.log(`Successfully inserted checkout for user ${row.User}`);
          successCount++;
        }
      } catch (error) {
        console.error(`Error processing row:`, row);
        console.error(error);
        errorCount++;
      }
    }

    console.log(`\nImport completed:`);
    console.log(`Successfully imported: ${successCount} rows`);
    console.log(`Failed to import: ${errorCount} rows`);
  } catch (error) {
    console.error("Error reading or processing CSV:", error);
  } finally {
    db.close();
  }
}

// Run the import
importData().catch((error) => {
  console.error("Import failed:", error);
  db.close();
});
