import { useEffect, useState } from "react";
import Card from "../ui/Card.jsx";
import DataTable from "../ui/DataTable.jsx";

const CablePullsTable = ({ initialData, loading }) => {
  const [data, setData] = useState(initialData || []);

  useEffect(() => {
    setData(initialData || []);
  }, [initialData]);

  return (
    <Card title="Recent Cable Pulls">
      <DataTable
        loading={loading}
        rows={data}
        rowKey={(row) => row.checkout_id}
        empty="No cable pulls recorded yet."
        columns={[
          { key: "timestamp", header: "Timestamp", render: (r) => <span className="text-slate-500">{r.timestamp}</span> },
          { key: "user", header: "User", render: (r) => r.user?.name },
          { key: "mo", header: "MO Number", render: (r) => r.project?.mo_num },
          { key: "item", header: "Item", render: (r) => r.item?.sku },
          { key: "quantity", header: "Quantity", render: (r) => r.quantity },
        ]}
      />
    </Card>
  );
};

export default CablePullsTable;
