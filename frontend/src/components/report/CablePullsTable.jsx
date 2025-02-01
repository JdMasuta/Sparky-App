import React, { useEffect, useState } from "react";
import "../../assets/css/style.css";

const CablePullsTable = ({ initialData }) => {
  const [data, setData] = useState(initialData || []);

  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  return (
    <div className="table-container">
      <div className="table-header">
        <h2>Recent Cable Pulls</h2>
      </div>
      <table className="responsive-table">
        <thead>
          <tr>
            <th className="p-2 text-left">Timestamp</th>
            <th className="p-2 text-left">User</th>
            <th className="p-2 text-left">MO Number</th>
            <th className="p-2 text-left">Item</th>
            <th className="p-2 text-left">Quantity</th>
          </tr>
        </thead>
        <tbody>
          {data.map((entry, index) => (
            <tr key={entry.checkout_id}>
              <td>{entry.timestamp}</td>
              <td>{entry.user.name}</td>
              <td>{entry.project.mo_num}</td>
              <td>{entry.item.sku}</td>
              <td>{entry.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default CablePullsTable;
