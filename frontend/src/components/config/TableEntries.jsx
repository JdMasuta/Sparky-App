import React, { useEffect, useState } from "react";
import useTableData from "./useTableData.jsx";
import EntryField from "../shared/EntryField.jsx";

// This object maps each table name to its primary key field
const tableKeyMap = {
  users: "user_id",
  items: "item_id",
  projects: "project_id",
  checkouts: "checkout_id",
};

// Helper function to get the correct ID from an entry
function getIdForTable(table, entry) {
  const keyName = tableKeyMap[table];
  return keyName ? entry[keyName] : entry.id;
}

function TableEntries({ table }) {
  const { tablesData, updateTable, preloadTables } = useTableData();
  const entries = tablesData[table] || [];

  const [isPreloaded, setIsPreloaded] = useState(false);

  // New state for controlling global editing mode and tracking changes
  const [globalEditing, setGlobalEditing] = useState(false);
  const [changedEntries, setChangedEntries] = useState({});

  /**
   * Preload all tables on mount (if not already preloaded).
   */
  useEffect(() => {
    if (!isPreloaded) {
      console.log("Preloading all tables...");
      preloadTables().then(() => setIsPreloaded(true));
    }
  }, [isPreloaded, preloadTables]);

  /**
   * Handle input changes for any entry in global editing mode.
   * This function updates the changes for the specific row.
   */
  const handleGlobalInputChange = (e, entryId) => {
    const { name, value } = e.target;
    setChangedEntries((prev) => {
      const currentEntryChanges = prev[entryId] || {};
      return {
        ...prev,
        [entryId]: {
          ...currentEntryChanges,
          [name]: value,
        },
      };
    });
  };

  /**
   * Enable global editing mode.
   */
  const enableEditing = () => {
    setGlobalEditing(true);
  };

  /**
   * Cancel global editing mode and clear any unsaved changes.
   */
  const cancelEditing = () => {
    setGlobalEditing(false);
    setChangedEntries({});
  };

  /**
   * Save all changes for the entries that have been modified.
   * This function iterates over the changed entries and calls updateTable
   * (acting as our "handleTableChanges" functionality).
   */
  const handleSaveAllChanges = () => {
    Object.entries(changedEntries).forEach(([id, newData]) => {
      updateTable(table, "edit", newData, id);
    });
    // Exit editing mode and clear changes
    setGlobalEditing(false);
    setChangedEntries({});
  };

  /**
   * If there is no data (or preload hasn’t finished), show a message.
   */
  if (!entries.length) {
    return (
      <p>
        No data available for <strong>{table}</strong>.
      </p>
    );
  }

  return (
    <div className="table-entries">
      <h3>{table.charAt(0).toUpperCase() + table.slice(1)} Entries</h3>

      {/* Global actions for editing */}
      <div className="table-actions">
        {globalEditing ? (
          <>
            <button onClick={handleSaveAllChanges}>Save Changes</button>
            <button onClick={cancelEditing}>Cancel Editing</button>
          </>
        ) : (
          <button onClick={enableEditing}>Edit All</button>
        )}
      </div>

      <div className="table-container">
        <table className="responsive-table">
          <thead>
            <tr>
              <th>Actions</th>
              {entries[0] &&
                Object.keys(entries[0]).map((key) => <th key={key}>{key}</th>)}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const entryId = getIdForTable(table, entry);
              return (
                <tr key={entryId}>
                  <td>
                    {/* The delete button is always available */}
                    <button
                      onClick={() =>
                        updateTable(table, "delete", null, entryId)
                      }
                    >
                      Delete
                    </button>
                  </td>
                  {Object.entries(entry).map(([key, value]) => (
                    <td key={key}>
                      {globalEditing ? (
                        <EntryField
                          name={key}
                          // Use the changed value if it exists; otherwise use the original value
                          value={changedEntries[entryId]?.[key] ?? value}
                          onChange={(e) => handleGlobalInputChange(e, entryId)}
                          placeholder={key}
                        />
                      ) : (
                        value
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TableEntries;
