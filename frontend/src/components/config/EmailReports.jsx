import React, { useState, useEffect } from "react";
import useTableData from "../config/useTableData.jsx";
import EntryField from "../shared/EntryField.jsx";

function EmailReports() {
  const { fetchTableData, updateTable } = useTableData();
  const [recipients, setRecipients] = useState([]);
  const [lastStatus, setLastStatus] = useState(null);
  const [newEmail, setNewEmail] = useState("");

  const loadRecipients = async () => {
    const data = await fetchTableData("report_recipients");
    setRecipients(data);
  };

  const loadStatus = async () => {
    const data = await fetchTableData("weekly_report_status");
    if (data.length > 0) {
      setLastStatus(data[data.length - 1]);
    }
  };

  useEffect(() => {
    loadRecipients();
    loadStatus();
  }, []);

  const handleRemove = async (id) => {
    await updateTable("report_recipients", "delete", null, id);
    await loadRecipients();
  };

  const handleAdd = async () => {
    const trimmed = newEmail.trim();
    if (!trimmed) return;
    await updateTable("report_recipients", "create", { email: trimmed });
    setNewEmail("");
    await loadRecipients();
  };

  return (
    <div className="config-section">
      <h2>Email Reports</h2>

      <div className="table-entries">
        <h3>Last Report Status</h3>
        {lastStatus ? (
          <div
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "4px",
              marginBottom: "1rem",
              background: lastStatus.success ? "#d4edda" : "#f8d7da",
              color: lastStatus.success ? "#155724" : "#721c24",
              border: `1px solid ${lastStatus.success ? "#c3e6cb" : "#f5c6cb"}`,
            }}
          >
            <strong>{lastStatus.success ? "Success" : "Failed"}</strong>
            {" — "}
            {lastStatus.ran_at}
            {!lastStatus.success && lastStatus.error_message && (
              <span> — {lastStatus.error_message}</span>
            )}
          </div>
        ) : (
          <p>No reports run yet.</p>
        )}
      </div>

      <div className="table-entries">
        <h3>Weekly Report Recipients</h3>
        <div className="table-container">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>id</th>
                <th>email</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.email}</td>
                  <td>
                    <button onClick={() => handleRemove(r.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-actions" style={{ marginTop: "0.75rem", alignItems: "flex-end" }}>
          <EntryField
            label="New Email"
            name="newEmail"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="email@example.com"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <button onClick={handleAdd}>Add</button>
        </div>
      </div>
    </div>
  );
}

export default EmailReports;
