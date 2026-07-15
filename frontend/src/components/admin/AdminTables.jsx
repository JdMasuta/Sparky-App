import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import Card from "../ui/Card.jsx";
import Button from "../ui/Button.jsx";
import Badge from "../ui/Badge.jsx";
import DataTable from "../ui/DataTable.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import EntryFormModal from "./EntryFormModal.jsx";
import useAlerts from "../shared/Alerts/useAlerts.jsx";
import { api } from "../../lib/api.js";
import { TABLES, schemas, columnLabel, formatDateTime } from "../../lib/tableSchemas.js";

const TIME_COLUMNS = new Set(["created_at", "timestamp"]);

export default function AdminTables() {
  const { addAlert } = useAlerts();
  const [table, setTable] = useState("users");
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // { mode, initial }
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await Promise.all(TABLES.map((t) => api.get(`/${t}`)));
      setData(Object.fromEntries(TABLES.map((t, i) => [t, entries[i]])));
    } catch (err) {
      addAlert({ message: `Failed to load tables: ${err.message}`, severity: "error", timeout: 6 });
    } finally {
      setLoading(false);
    }
  }, [addAlert]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const schema = schemas[table];
  const rows = data[table] || [];

  const columns = [
    ...schema.columns.map((key) => ({
      key,
      header: columnLabel(key),
      render: TIME_COLUMNS.has(key)
        ? (row) => <span className="text-slate-500">{formatDateTime(row[key])}</span>
        : key === "status"
        ? (row) => (
            <Badge tone={row.status === "INACTIVE" ? "neutral" : "green"}>
              {row.status || "ACTIVE"}
            </Badge>
          )
        : undefined,
    })),
    {
      key: "_actions",
      header: "",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={() => setModal({ mode: "edit", initial: row })}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-600"
            aria-label="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => setToDelete(row)}
            className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
      className: "text-right",
    },
  ];

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await api.del(`/${table}/${toDelete[schema.pk]}`);
      addAlert({ message: "Entry deleted.", severity: "success", timeout: 3 });
      setToDelete(null);
      await loadAll();
    } catch (err) {
      addAlert({ message: err.message || "Delete failed", severity: "error", timeout: 6 });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Table selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {TABLES.map((t) => (
            <button
              key={t}
              onClick={() => setTable(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                table === t ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {schemas[t].label}
            </button>
          ))}
        </div>
        <Button onClick={() => setModal({ mode: "add", initial: null })}>
          <Plus className="h-4 w-4" /> Add {schema.label.replace(/s$/, "")}
        </Button>
      </div>

      <Card title={`${schema.label} (${rows.length})`}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row[schema.pk]}
          loading={loading}
          empty={`No ${schema.label.toLowerCase()} yet. Use "Add" to create one.`}
        />
      </Card>

      {modal && (
        <EntryFormModal
          isOpen
          table={table}
          mode={modal.mode}
          initial={modal.initial}
          refData={data}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            addAlert({ message: "Saved.", severity: "success", timeout: 3 });
            await loadAll();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        busy={deleting}
        title={`Delete ${schema.label.replace(/s$/, "").toLowerCase()}?`}
        message="This cannot be undone. Records referenced by existing checkouts cannot be deleted."
      />
    </div>
  );
}
