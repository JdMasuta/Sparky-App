import React, { useEffect } from "react";
import EmailReports from "../components/config/EmailReports.jsx";
import DatabaseManagement from "../components/config/DatabaseManagement.jsx";
import useTableData from "../components/config/useTableData.jsx";

function Config() {
  const { preloadTables } = useTableData();

  useEffect(() => {
    preloadTables();
  }, [preloadTables]);

  return (
    <div className="container">
      <h1 className="config-title">Settings</h1>

      <EmailReports />
      <DatabaseManagement />
    </div>
  );
}

export default Config;
