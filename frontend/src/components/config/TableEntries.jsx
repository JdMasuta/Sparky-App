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
  // Global editing state for existing rows:
  const [globalEditing, setGlobalEditing] = useState(false);
  const [changedEntries, setChangedEntries] = useState({});
  // New entry state:
  const [isCreatingEntry, setIsCreatingEntry] = useState(false);
  const [newEntry, setNewEntry] = useState({});

  // Preload all tables on mount
  useEffect(() => {
    if (!isPreloaded) {
      console.log("Preloading all tables...");
      preloadTables().then(() => setIsPreloaded(true));
    }
  }, [isPreloaded, preloadTables]);

  /**
   * Handle changes for existing entry rows in global editing mode.
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
   * Enable global editing.
   */
  const enableEditing = () => {
    setGlobalEditing(true);
  };

  /**
   * Cancel global editing and clear any unsaved changes.
   */
  const cancelEditing = () => {
    setGlobalEditing(false);
    setChangedEntries({});
  };

  /**
   * Save changes for all modified entries.
   */
  const handleSaveAllChanges = () => {
    Object.entries(changedEntries).forEach(([id, newData]) => {
      updateTable(table, "edit", newData, id);
    });
    setGlobalEditing(false);
    setChangedEntries({});
  };

  /**
   * Initialize a new entry and show the new entry row.
   */
  const handleNewEntry = () => {
    // Use the keys from the first entry as a template (if available)
    if (entries.length > 0) {
      const template = {};
      Object.keys(entries[0]).forEach((key) => {
        template[key] = "";
      });
      setNewEntry(template);
    }
    setIsCreatingEntry(true);
  };

  /**
   * Handle changes for the new entry fields.
   */
  const handleNewEntryChange = (e, key) => {
    const { value } = e.target;
    setNewEntry((prev) => ({ ...prev, [key]: value }));
  };

  /**
   * Submit the new entry (using a POST request via updateTable).
   */
  const handleSubmitNewEntry = () => {
    // Filter out fields that end with "_ID"
    const filteredNewEntry = Object.fromEntries(
      Object.entries(newEntry).filter(
        ([key]) => !key.toUpperCase().endsWith("_ID")
      )
    );

    console.log("Submitting new entry:", filteredNewEntry);
    // Use the "create" operation for new entries (assumed to map to POST)
    updateTable(table, "create", filteredNewEntry);
    setIsCreatingEntry(false);
    setNewEntry({});
  };

  // If there is no data (or preload hasn’t finished), show a message.
  if (!entries.length) {
    return (
      <p>
        No data available for <strong>{table}</strong>.
      </p>
    );
  }

  // Use the keys from the first entry as column headers.
  const entryKeys = Object.keys(entries[0]);

  return (
    <div className="table-entries">
      <h3>{table.charAt(0).toUpperCase() + table.slice(1)} Entries</h3>

      {/* Global actions for editing and adding a new entry */}
      <div className="table-actions">
        {globalEditing ? (
          <>
            <button onClick={handleSaveAllChanges}>Save Changes</button>
            <button onClick={cancelEditing}>Cancel Editing</button>
          </>
        ) : (
          <>
            <button onClick={enableEditing}>Edit All</button>
            <button onClick={handleNewEntry}>New Entry</button>
          </>
        )}
      </div>

      <div className="table-container">
        <table className="responsive-table">
          <thead>
            <tr>
              {/* Render column headers from entry keys */}
              {entryKeys.map((key) => (
                <th key={key}>{key}</th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* New Entry row */}
            {isCreatingEntry && (
              <tr key="new-entry">
                {entryKeys
                  .filter((key) => !key.toUpperCase().endsWith("_ID"))
                  .map((key) => (
                    <td key={key}>
                      <EntryField
                        name={key}
                        value={newEntry[key]}
                        onChange={(e) => handleNewEntryChange(e, key)}
                        placeholder={key}
                      />
                    </td>
                  ))}
                <td>
                  <button onClick={handleSubmitNewEntry}>Submit</button>
                </td>
              </tr>
            )}

            {/* Existing rows */}
            {entries.map((entry) => {
              const entryId = getIdForTable(table, entry);
              return (
                <tr key={entryId}>
                  {Object.entries(entry).map(([key, value]) => (
                    <td key={key}>
                      {globalEditing ? (
                        <EntryField
                          name={key}
                          // Use the changed value if it exists; otherwise, the original value
                          value={changedEntries[entryId]?.[key] ?? value}
                          onChange={(e) => handleGlobalInputChange(e, entryId)}
                          placeholder={key}
                        />
                      ) : (
                        value
                      )}
                    </td>
                  ))}
                  <td>
                    <button
                      onClick={() =>
                        updateTable(table, "delete", null, entryId)
                      }
                    >
                      Delete
                    </button>
                  </td>
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
