import React, { useState, useMemo } from "react";
import { ArrowUpDown } from "lucide-react";
import { useEmailReport } from "./useEmailReport";

const CheckoutReport = ({
  data = { timestamp: "", total_records: 0, data: [] },
}) => {
  const [sortField, setSortField] = useState("project_number");
  const [sortDirection, setSortDirection] = useState("asc");
  const [selectedProject, setSelectedProject] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState(""); // Email state
  const { sendEmailReport } = useEmailReport({ timestamp: data.timestamp });

  const handleSendEmail = async () => {
    setIsLoading(true);
    await sendEmailReport(email); // Pass the dynamic email
    setEmail(""); // Clear input field
    setIsLoading(false);
  };

  const sortedData = useMemo(() => {
    if (!data?.data || !Array.isArray(data.data)) return [];
    return [...data.data].sort((a, b) => {
      const dir = sortDirection === "asc" ? 1 : -1;
      if (sortField === "total_quantity") {
        return dir * (parseInt(a[sortField], 10) - parseInt(b[sortField], 10));
      }
      return dir * String(a[sortField]).localeCompare(String(b[sortField]));
    });
  }, [data, sortField, sortDirection]);

  const filteredData = selectedProject
    ? sortedData.filter((item) => item.project_number === selectedProject)
    : sortedData;

  const handleSort = (field) => {
    if (field === sortField) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg p-6 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Detailed Report</h2>
          <div className="flex items-center gap-2">
            <div className="checkout-button">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter email"
                  className="px-3 py-2 border rounded-md"
                />
                <button
                  onClick={handleSendEmail}
                  disabled={isLoading || !email.trim()}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-400"
                >
                  {isLoading ? "Sending..." : "Email Report"}
                </button>
              </div>
            </div>
          {selectedProject && (
            <button
              onClick={() => setSelectedProject(null)}
              className="px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-md"
            >
              Clear Filter
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th
                  onClick={() => handleSort("project_number")}
                  className="px-4 py-3 text-left cursor-pointer hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2">
                    Project Number
                    <ArrowUpDown className="h-4 w-4 text-gray-400" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort("item_sku")}
                  className="px-4 py-3 text-left cursor-pointer hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2">
                    SKU
                    <ArrowUpDown className="h-4 w-4 text-gray-400" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort("item_name")}
                  className="px-4 py-3 text-left cursor-pointer hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2">
                    Item Name
                    <ArrowUpDown className="h-4 w-4 text-gray-400" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort("total_quantity")}
                  className="px-4 py-3 text-right cursor-pointer hover:bg-gray-50"
                >
                  <div className="flex items-center justify-end gap-2">
                    Total Quantity
                    <ArrowUpDown className="h-4 w-4 text-gray-400" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((row, index) => (
                <tr
                  key={`${row.project_number}-${row.item_sku}-${index}`}
                  className="border-b border-gray-100 hover:bg-gray-50"
                >
                  <td className="px-4 py-3">{row.project_number}</td>
                  <td className="px-4 py-3">{row.item_sku}</td>
                  <td className="px-4 py-3">{row.item_name}</td>
                  <td className="px-4 py-3 text-right">
                    {parseInt(row.total_quantity, 10).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CheckoutReport;
