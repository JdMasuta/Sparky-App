import React, { useState } from "react";
import TableSelector from "./TableSelector.jsx";
import TableEntries from "./TableEntries.jsx";

function DatabaseManagement() {
  const [selectedTable, setSelectedTable] = useState("users");

  const handleTableChange = (table) => {
    setSelectedTable(table);
  };

  return (
    <div className="config-section">
      <h2>Database Management</h2>
      <TableSelector
        selectedTable={selectedTable}
        onChange={handleTableChange}
      />
      <TableEntries table={selectedTable} />
    </div>
  );
}

export default DatabaseManagement;
