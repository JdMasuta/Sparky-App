import { useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import Card from "../ui/Card.jsx";
import Button from "../ui/Button.jsx";
import Badge from "../ui/Badge.jsx";
import DataTable from "../ui/DataTable.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import EntryFormModal from "./EntryFormModal.jsx";
import useAlerts from "../shared/Alerts/useAlerts.jsx";
import { api } from "../../lib/api.js";
import { useCachedGet, invalidate, patchList } from "../../lib/adminCache.js";
import {
  TABLES,
  schemas,
  columnLabel,
  formatDateTime,
  FK_DISPLAY,
} from "../../lib/tableSchemas.js";

const TIME_COLUMNS = new Set(["created_at", "timestamp"]);
const TABLE_TTL = 30_000;

export default function AdminTables() {
  const { addAlert } = useAlerts();
  const [table, setTable] = useState("users");
  const [modal, setModal] = useState(null); // { mode, initial }
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // One cached query per table (TABLES is fixed, so hook order is stable).
  const usersQ = useCachedGet("/users", { ttl: TABLE_TTL });
  const projectsQ = useCachedGet("/projects", { ttl: TABLE_TTL });
  const itemsQ = useCachedGet("/items", { ttl: TABLE_TTL });
  const checkoutsQ = useCachedGet("/checkouts", { ttl: TABLE_TTL });
  const queries = { users: usersQ, projects: projectsQ, items: itemsQ, checkouts: checkoutsQ };
  const data = Object.fromEntries(TABLES.map((t) => [t, queries[t].data ?? []]));
  const loading = TABLES.some((t) => queries[t].loading);

  const refreshAll = () =>
    Promise.all(TABLES.map((t) => queries[t].refresh())).catch((err) =>
      addAlert({ message: `Refresh failed: ${err.message}`, severity: "error", timeout: 6 }),
    );

  const schema = schemas[table];
  // Newest first: primary keys are AUTOINCREMENT, so descending PK = insertion order.
  const rows = [...data[table]].sort((a, b) => b[schema.pk] - a[schema.pk]);

  // Lookup maps (id -> row) for resolving foreign keys to display names.
  const refIndex = (ref) => {
    const pk = schemas[ref].pk;
    const map = new Map();
    for (const row of data[ref] || []) map.set(row[pk], row);
    return map;
  };
  const fkName = (colKey, id) => {
    const spec = FK_DISPLAY[colKey];
    if (!spec) return id;
    const row = refIndex(spec.ref).get(id);
    return row ? spec.field(row) : id;
  };

  const columns = [
    ...schema.columns.map((key) => {
      const fk = FK_DISPLAY[key];
      if (fk) {
        // Show the referenced entity's name; keep the id as a tooltip; filter by name.
        return {
          key,
          header: fk.label,
          filterValue: (row) => String(fkName(key, row[key]) ?? ""),
          render: (row) => (
            <span title={`id ${row[key]}`}>{fkName(key, row[key]) ?? "—"}</span>
          ),
        };
      }
      return {
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
      };
    }),
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
      filterable: false,
    },
  ];

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const deletedId = toDelete[schema.pk];
      await api.del(`/${table}/${deletedId}`);
      addAlert({ message: "Entry deleted.", severity: "success", timeout: 3 });
      setToDelete(null);
      patchList(`/${table}`, (list) => list.filter((r) => r[schema.pk] !== deletedId));
      invalidate("/admin/overview");
    } catch (err) {
      addAlert({ message: err.message || "Delete failed", severity: "error", timeout: 6 });
    } finally {
      setDeleting(false);
    }
  };

  // Merge the saved row into the cached list; refetch only if the response
  // didn't include the row (older backend).
  const applySaved = (savedRow) => {
    setModal(null);
    addAlert({ message: "Saved.", severity: "success", timeout: 3 });
    if (savedRow) {
      patchList(`/${table}`, (list) => {
        const idx = list.findIndex((r) => r[schema.pk] === savedRow[schema.pk]);
        if (idx === -1) return [...list, savedRow];
        const next = [...list];
        next[idx] = savedRow;
        return next;
      });
    } else {
      invalidate(`/${table}`);
    }
    invalidate("/admin/overview");
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
        <div className="flex gap-2">
          <Button variant="secondary" onClick={refreshAll}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button onClick={() => setModal({ mode: "add", initial: null })}>
            <Plus className="h-4 w-4" /> Add {schema.label.replace(/s$/, "")}
          </Button>
        </div>
      </div>

      <Card title={`${schema.label} (${rows.length})`}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row[schema.pk]}
          loading={loading}
          filterable
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
          onSaved={applySaved}
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
