/* global __APP_VERSION__ */
import { useEffect, useState } from "react";
import { RefreshCw, Trash2, Activity } from "lucide-react";
import Card from "../ui/Card.jsx";
import Button from "../ui/Button.jsx";
import Badge from "../ui/Badge.jsx";
import DataTable from "../ui/DataTable.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import useAlerts from "../shared/Alerts/useAlerts.jsx";
import { api } from "../../lib/api.js";

const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

export default function AdminSystem() {
  const { addAlert } = useAlerts();
  const [status, setStatus] = useState(null);
  const [tags, setTags] = useState([]);
  const [values, setValues] = useState(null);
  const [reading, setReading] = useState(false);
  const [purging, setPurging] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);

  const loadDiagnostics = async () => {
    try {
      const [s, t] = await Promise.all([api.get("/plc/status"), api.get("/plc/tags")]);
      setStatus(s);
      setTags(t.tags || []);
    } catch (err) {
      addAlert({ message: `Diagnostics unavailable: ${err.message}`, severity: "error", timeout: 6 });
    }
  };

  useEffect(() => {
    loadDiagnostics();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const readAll = async () => {
    setReading(true);
    try {
      const { results } = await api.post("/plc/read", { tags: tags.map((t) => t.alias) });
      setValues(results);
    } catch (err) {
      addAlert({ message: `Read failed: ${err.message}`, severity: "error", timeout: 6 });
    } finally {
      setReading(false);
    }
  };

  const purge = async () => {
    setPurging(true);
    try {
      const res = await api.del("/purge");
      addAlert({
        message: `Purged ${res.affectedRows ?? 0} invalid checkout(s).`,
        severity: "success",
        timeout: 4,
      });
      setConfirmPurge(false);
    } catch (err) {
      addAlert({ message: err.message, severity: "error", timeout: 6 });
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Version">
          <p className="text-2xl font-semibold text-slate-800">Sparky Cart {version}</p>
          <p className="mt-1 text-xs text-slate-400">
            Remote updates are delivered as versioned releases and applied on-device.
          </p>
        </Card>

        <Card
          title="PLC bridge"
          actions={
            <Button variant="secondary" size="sm" onClick={loadDiagnostics}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          }
        >
          {status ? (
            <div className="flex items-center gap-2">
              <Badge tone={status.connected ? "green" : "red"}>
                {status.connected ? "Connected" : "Disconnected"}
              </Badge>
              {status.mode === "sim" && <Badge tone="amber">Simulation</Badge>}
              {status.mode === "real" && <Badge tone="brand">Live PLC</Badge>}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Loading…</p>
          )}
        </Card>
      </div>

      <Card
        title="PLC tag diagnostics"
        actions={
          <Button variant="secondary" size="sm" onClick={readAll} disabled={reading || tags.length === 0}>
            <Activity className="h-4 w-4" /> {reading ? "Reading…" : "Read all tags"}
          </Button>
        }
      >
        <DataTable
          rows={tags}
          rowKey={(t) => t.alias}
          empty="No tags defined."
          columns={[
            { key: "alias", header: "Alias", render: (t) => <span className="font-medium">{t.alias}</span> },
            { key: "name", header: "PLC address", render: (t) => <code className="text-xs">{t.name}</code> },
            { key: "type", header: "Type", render: (t) => <Badge>{t.type}</Badge> },
            {
              key: "value",
              header: "Value",
              render: (t) =>
                values ? (
                  <span className="font-mono text-xs">{String(values[t.alias] ?? "—")}</span>
                ) : (
                  <span className="text-slate-300">—</span>
                ),
            },
          ]}
        />
      </Card>

      <Card title="Maintenance">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-700">Purge invalid checkouts</p>
            <p className="text-xs text-slate-400">Removes checkout rows with a quantity of zero.</p>
          </div>
          <Button variant="danger" onClick={() => setConfirmPurge(true)} disabled={purging}>
            <Trash2 className="h-4 w-4" /> Purge
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        isOpen={confirmPurge}
        onClose={() => setConfirmPurge(false)}
        onConfirm={purge}
        busy={purging}
        title="Purge invalid checkouts?"
        confirmLabel="Purge"
        message="This permanently deletes all checkouts with a quantity of zero."
      />
    </div>
  );
}
