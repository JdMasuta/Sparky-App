import React from "react";

function TableSelector({ selectedTable, onChange }) {
  const tables = ["users", "projects", "items", "checkouts"];

  return (
    <div className="table-selector">
      <label htmlFor="table-select">Select Table:</label>
      <select
        id="table-select"
        value={selectedTable}
        onChange={(e) => onChange(e.target.value)}
      >
        {tables.map((table) => (
          <option key={table} value={table}>
            {table.charAt(0).toUpperCase() + table.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );
}

export default TableSelector;
