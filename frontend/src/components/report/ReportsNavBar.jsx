import { useState } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { FileBarChart } from "lucide-react";
import Card from "../ui/Card.jsx";
import Button from "../ui/Button.jsx";
import Modal from "../ui/Modal.jsx";
import useAlerts from "../shared/Alerts/useAlerts.jsx";
import CheckoutReport from "./CheckoutReportDashboard.jsx";

const NavBar = () => {
  const { addAlert } = useAlerts();
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleGenerateReport = async () => {
    if (!startDate || !endDate) {
      addAlert({ message: "Please select a valid date range.", severity: "warning", timeout: 4 });
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/checkout_report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
        }),
      });
      if (!response.ok) {
        addAlert({ message: "No data found for that range.", severity: "info", timeout: 4 });
        return;
      }
      setReportData(await response.json());
      setIsModalOpen(true);
    } catch (err) {
      addAlert({ message: `Report failed: ${err.message}`, severity: "error", timeout: 5 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="Generate Report">
      <div className="flex flex-wrap items-center gap-3">
        <DatePicker
          selectsRange
          startDate={startDate}
          endDate={endDate}
          onChange={(dates) => {
            const [start, end] = dates;
            setStartDate(start);
            setEndDate(end);
          }}
          isClearable
          placeholderText="Select a date range"
          className="rounded-lg border-0 px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
        />
        <Button onClick={handleGenerateReport} disabled={loading}>
          <FileBarChart className="h-4 w-4" /> {loading ? "Generating…" : "Generate Report"}
        </Button>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Checkout Report" size="lg">
        {reportData && <CheckoutReport data={reportData} timestamp={startDate} />}
      </Modal>
    </Card>
  );
};

export default NavBar;
