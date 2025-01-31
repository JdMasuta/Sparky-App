import React, { useState } from "react";

function EmailReports() {
  const [emailSchedule, setEmailSchedule] = useState("daily");

  const handleScheduleChange = (e) => {
    setEmailSchedule(e.target.value);
  };

  return (
    <div className="config-section">
      <h2>Email Reports</h2>
      <label htmlFor="email-schedule">Send Reports:</label>
      <select
        id="email-schedule"
        value={emailSchedule}
        onChange={handleScheduleChange}
      >
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
    </div>
  );
}

export default EmailReports;
