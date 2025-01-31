import React, { useEffect, useState } from "react";
import useTableData from "./useTableData.jsx";
import EntryField from "../shared/EntryField.jsx"; // Import the EntryField component

// This object maps each table name to its primary key field
const tableKeyMap = {
  users: "user_id",
  items: "item_id",
  projects: "project_id",
  checkouts: "checkout_id",
};

// A helper function that returns the correct primary key value
// for a given table and entry object:
function getIdForTable(table, entry) {
  const keyName = tableKeyMap[table];
  return keyName ? entry[keyName] : entry.id;
}

function TableEntries({ table }) {
  const { tablesData, updateTable, preloadTables } = useTableData();

  const [editing, setEditing] = useState(null); // Track which row is being edited (by ID)
  const [editedEntry, setEditedEntry] = useState({}); // Track changes to the edited entry
  const entries = tablesData[table] || []; // Ensure entries is always an array

  const [isPreloaded, setIsPreloaded] = useState(false);

  /**
   * Preload ALL tables once on mount, if not already preloaded.
   */
  useEffect(() => {
    if (!isPreloaded) {
      console.log("Preloading all tables...");
      preloadTables().then(() => setIsPreloaded(true));
    }
  }, [isPreloaded, preloadTables]);

  /**
   * Handle input changes for the edited entry
   */
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setEditedEntry((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  /**
   * Start editing a specific entry
   */
  const startEditing = (entry) => {
    setEditing(getIdForTable(table, entry)); // Set the ID of the entry being edited
    setEditedEntry(entry); // Populate the editedEntry state with the entry's data
  };

  /**
   * Save the edited entry
   */
  const saveEditedEntry = () => {
    updateTable(table, "edit", editedEntry, editing);
    setEditing(null); // Exit edit mode
    setEditedEntry({}); // Clear the edited entry
  };

  /**
   * Early return if there's truly no data (empty array) for this table
   * or if preload hasn't happened yet.
   */
  if (!entries.length) {
    return (
      <p>
        No data available for <strong>{table}</strong>.
      </p>
    );
  }

  /**
   * Main component rendering
   */
  return (
    <div className="table-entries">
      <h3>{table.charAt(0).toUpperCase() + table.slice(1)} Entries</h3>
      <table>
        <thead>
          <tr>
            {entries[0] &&
              Object.keys(entries[0]).map((key) => <th key={key}>{key}</th>)}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const entryId = getIdForTable(table, entry);
            const isEditing = editing === entryId;

            return (
              <tr key={entryId}>
                {Object.entries(entry).map(([key, value]) => (
                  <td key={key}>
                    {isEditing ? (
                      <EntryField
                        name={key}
                        value={editedEntry[key] || ""}
                        onChange={handleInputChange}
                        placeholder={key}
                      />
                    ) : (
                      value
                    )}
                  </td>
                ))}
                <td>
                  {isEditing ? (
                    <>
                      <button onClick={saveEditedEntry}>Save</button>
                      <button
                        onClick={() => {
                          setEditing(null); // Cancel edit mode
                          setEditedEntry({}); // Clear the edited entry
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEditing(entry)}>Edit</button>
                      <button
                        onClick={() =>
                          updateTable(table, "delete", null, entryId)
                        }
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default TableEntries;
