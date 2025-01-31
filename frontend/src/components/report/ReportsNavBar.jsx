import React, { useState } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css"; // Default CSS for the date picker
import "../../assets/css/style.css";
import CheckoutReport from "./CheckoutReportDashboard.jsx";
import Modal from "../shared/Modal.jsx";

const NavBar = () => {
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleGenerateReport = async () => {
    if (!startDate || !endDate) {
      alert("Please select a valid date range.");
      return;
    }

    const response = await fetch("/api/checkout_report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: startDate.toISOString().split("T")[0], // Format as YYYY-MM-DD
        endDate: endDate.toISOString().split("T")[0], // Format as YYYY-MM-DD
      }),
    });
    const data = await response.json();
    setReportData(data);
    setIsModalOpen(true);
  };

  return (
    <div>
      <br />
      <nav className="nav">
        <div className="nav-content">
          <h1>BW Cable Audit System</h1>
          <DatePicker
            selectsRange={true}
            startDate={startDate}
            endDate={endDate}
            onChange={(dates) => {
              const [start, end] = dates;
              setStartDate(start);
              setEndDate(end);
            }}
            isClearable={true}
            placeholderText="Select a date range"
            className="date-input"
          />
          <button
            onClick={handleGenerateReport}
            className="generate-report-button"
          >
            Generate Report
          </button>
          <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
            {reportData && <CheckoutReport data={reportData} />}
          </Modal>
        </div>
      </nav>
    </div>
  );
};

export default NavBar;
