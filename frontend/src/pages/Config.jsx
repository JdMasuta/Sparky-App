import React, { useState } from "react";
import EmailReports from "../components/config/EmailReports.jsx";
import DatabaseManagement from "../components/config/DatabaseManagement.jsx";

function Config() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const handleUnlock = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: pin }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsUnlocked(true);
        setPin("");
      } else {
        setError(data.error || "Incorrect password");
      }
    } catch {
      setError("Unable to sign in. Check server connection.");
    }
  };

  const handleLock = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* ignore */
    }
    setIsUnlocked(false);
  };

  if (!isUnlocked) {
    return (
      <div className="container">
        <h1 className="config-title">Settings</h1>
        <div style={{ maxWidth: "320px", margin: "2rem auto", padding: "1.5rem", border: "1px solid #ddd", borderRadius: "8px", textAlign: "center" }}>
          <p style={{ marginBottom: "1.5rem", color: "#555" }}>This page is locked.</p>
          <form onSubmit={handleUnlock}>
            <div className="form-group" style={{ textAlign: "left" }}>
              <label htmlFor="pin-input">Password</label>
              <input
                id="pin-input"
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter admin password"
                autoFocus
              />
            </div>
            {error && <p style={{ color: "#c0392b", marginBottom: "0.75rem", fontSize: "0.875rem" }}>{error}</p>}
            <button type="submit" className="email-button" style={{ marginBottom: 0 }}>Unlock</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 className="config-title">Settings</h1>
        <button onClick={handleLock} style={{ padding: "0.4rem 1rem", background: "#555", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>
          Lock
        </button>
      </div>

      <EmailReports />
      <DatabaseManagement />
    </div>
  );
}

export default Config;
