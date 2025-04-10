// Description: This component displays entries for a given table, allowing users to edit and add new entries. It uses a modal for adding new entries and handles global editing of existing entries.
// It also preloads all tables on mount and provides a way to delete entries.

import React, { useEffect, useState } from "react";
import useTableData from "./useTableData.jsx";
import EntryField from "../shared/EntryField.jsx";
import SelectField from "../shared/SelectField.jsx";
import Modal from "../shared/Modal.jsx";

// This object maps each table name to its primary key field
const tableKeyMap = {
  users: "user_id",
  items: "item_id",
  projects: "project_id",
  checkouts: "checkout_id",
};

// Field types configuration
const fieldTypesConfig = {
  status: {
    type: "select",
    options: ["ACTIVE", "INACTIVE"],
  },
  // Add more field configurations as needed
};

// Helper function to get the correct ID from an entry
function getIdForTable(table, entry) {
  const keyName = tableKeyMap[table];
  return keyName ? entry[keyName] : entry.id;
}

// Helper function to determine if a field should use a specific input type
function getFieldType(fieldName) {
  const fieldConfig = fieldTypesConfig[fieldName.toLowerCase()];
  return fieldConfig ? fieldConfig.type : "text";
}

// Helper function to get options for a select field
function getFieldOptions(fieldName) {
  const fieldConfig = fieldTypesConfig[fieldName.toLowerCase()];
  return fieldConfig && fieldConfig.type === "select"
    ? fieldConfig.options
    : [];
}

function TableEntries({ table }) {
  const { tablesData, updateTable, preloadTables } = useTableData();
  const entries = tablesData[table] || [];

  const [isPreloaded, setIsPreloaded] = useState(false);
  const [globalEditing, setGlobalEditing] = useState(false);
  const [changedEntries, setChangedEntries] = useState({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newEntry, setNewEntry] = useState({});

  // Preload all tables on mount
  useEffect(() => {
    if (!isPreloaded) {
      console.log("Preloading all tables...");
      preloadTables().then(() => setIsPreloaded(true));
    }
  }, [isPreloaded, preloadTables]);

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
    const filteredNewEntry = Object.fromEntries(
      Object.entries(newEntry).filter(
        ([key]) => !key.toUpperCase().endsWith("_ID")
      )
    );

    console.log("Submitting new entry:", filteredNewEntry);
    updateTable(table, "create", filteredNewEntry);
    setIsModalOpen(false);
    setNewEntry({});
  };

  /**
   * Open the modal for adding a new entry.
   */
  const handleNewEntry = () => {
    if (entries.length > 0) {
      const template = {};
      Object.keys(entries[0]).forEach((key) => {
        template[key] = "";
      });
      setNewEntry(template);
    }
    setIsModalOpen(true);
  };

  /**
   * Cancel adding a new entry and close the modal.
   */
  const handleCancelNewEntry = () => {
    setIsModalOpen(false);
    setNewEntry({});
  };

  /**
   * Render the appropriate input field based on field type
   */
  const renderInputField = (fieldName, value, onChange) => {
    const fieldType = getFieldType(fieldName);

    if (fieldType === "select") {
      return (
        <SelectField
          name={fieldName}
          value={value}
          onChange={onChange}
          options={getFieldOptions(fieldName)}
          placeholder={`Select ${fieldName}`}
        />
      );
    }

    return (
      <EntryField
        name={fieldName}
        value={value}
        onChange={onChange}
        placeholder={fieldName}
      />
    );
  };

  // If there is no data (or preload hasn't finished), show a message.
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
            <button onClick={() => setGlobalEditing(false)}>
              Save Changes
            </button>
            <button onClick={() => setChangedEntries({})}>
              Cancel Editing
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setGlobalEditing(true)}>Edit All</button>
            <button onClick={handleNewEntry}>New Entry</button>
          </>
        )}
      </div>

      <div className="table-container">
        <table className="responsive-table">
          <thead>
            <tr>
              {entryKeys.map((key) => (
                <th key={key}>{key}</th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const entryId = getIdForTable(table, entry);
              return (
                <tr key={entryId}>
                  {Object.entries(entry).map(([key, value]) => (
                    <td key={key}>
                      {globalEditing
                        ? renderInputField(
                            key,
                            changedEntries[entryId]?.[key] ?? value,
                            (e) =>
                              setChangedEntries((prev) => ({
                                ...prev,
                                [entryId]: {
                                  ...prev[entryId],
                                  [key]: e.target.value,
                                },
                              }))
                          )
                        : value}
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

      {/* Modal for adding a new entry */}
      <Modal isOpen={isModalOpen} onClose={handleCancelNewEntry}>
        <h3>Add New Entry</h3>
        <form>
          {entryKeys
            .filter((key) => !key.toUpperCase().endsWith("_ID"))
            .map((key) => (
              <div key={key} className="modal-field">
                <label htmlFor={key}>{key}</label>
                {renderInputField(key, newEntry[key], (e) =>
                  handleNewEntryChange(e, key)
                )}
              </div>
            ))}
          <div className="modal-actions">
            <button type="button" onClick={handleSubmitNewEntry}>
              Submit
            </button>
            <button type="button" onClick={handleCancelNewEntry}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default TableEntries;
