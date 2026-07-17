/* global __APP_VERSION__ */
import { useState } from "react";
import { RefreshCw, Trash2, Activity, DownloadCloud } from "lucide-react";
import Card from "../ui/Card.jsx";
import Button from "../ui/Button.jsx";
import Badge from "../ui/Badge.jsx";
import DataTable from "../ui/DataTable.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import useAlerts from "../shared/Alerts/useAlerts.jsx";
import { api } from "../../lib/api.js";
import { useCachedGet } from "../../lib/adminCache.js";

const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

export default function AdminSystem() {
  const { addAlert } = useAlerts();
  const [values, setValues] = useState(null);
  const [reading, setReading] = useState(false);
  const [purging, setPurging] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);

  const statusQ = useCachedGet("/plc/status", { ttl: 10_000 });
  const tagsQ = useCachedGet("/plc/tags", { ttl: 300_000 });
  const infoQ = useCachedGet("/system/info", { ttl: 60_000 });
  const status = statusQ.data ?? null;
  const tags = tagsQ.data?.tags ?? [];
  const sysInfo = infoQ.data ?? null;

  const loadDiagnostics = async () => {
    try {
      await Promise.all([statusQ.refresh(), tagsQ.refresh(), infoQ.refresh()]);
    } catch (err) {
      addAlert({ message: `Diagnostics unavailable: ${err.message}`, severity: "error", timeout: 6 });
    }
  };

  const applyUpdate = async () => {
    setUpdating(true);
    try {
      const res = await api.post("/system/update");
      addAlert({ message: res.message || "Update started.", severity: "info", timeout: 6 });
      setConfirmUpdate(false);
    } catch (err) {
      addAlert({
        message: err.status === 501 ? "Updates run only on the edge device." : err.message,
        severity: err.status === 501 ? "warning" : "error",
        timeout: 6,
      });
      setConfirmUpdate(false);
    } finally {
      setUpdating(false);
    }
  };

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
        <Card
          title="Version & updates"
          actions={
            <Button variant="secondary" size="sm" onClick={() => setConfirmUpdate(true)}>
              <DownloadCloud className="h-4 w-4" /> Check &amp; apply update
            </Button>
          }
        >
          <p className="text-2xl font-semibold text-slate-800">Sparky Cart {version}</p>
          <p className="mt-1 text-xs text-slate-400">
            {sysInfo
              ? `Node ${sysInfo.node} · ${sysInfo.environment} · PLC ${sysInfo.plcMode}`
              : "Remote updates are delivered as versioned releases and applied on-device."}
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
          ) : statusQ.error ? (
            <p className="text-sm text-red-600">Diagnostics unavailable: {statusQ.error.message}</p>
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

      <ConfirmDialog
        isOpen={confirmUpdate}
        onClose={() => setConfirmUpdate(false)}
        onConfirm={applyUpdate}
        busy={updating}
        variant="primary"
        title="Check for and apply an update?"
        confirmLabel="Update now"
        message="If a newer release is available it will be downloaded, verified, and installed. Services will restart, and the update rolls back automatically if the health check fails."
      />
    </div>
  );
}
