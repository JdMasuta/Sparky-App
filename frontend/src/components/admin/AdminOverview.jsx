/* global __APP_VERSION__ */
import { Users, FolderKanban, Package, ClipboardList, Cpu, AlertTriangle } from "lucide-react";
import StatCard from "../ui/StatCard.jsx";
import Card from "../ui/Card.jsx";
import Badge from "../ui/Badge.jsx";
import Spinner from "../ui/Spinner.jsx";
import { useCachedGet } from "../../lib/adminCache.js";
import { formatDateTime } from "../../lib/tableSchemas.js";

const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

export default function AdminOverview() {
  const { data, error } = useCachedGet("/admin/overview", { ttl: 15_000 });

  if (!data) {
    if (error) {
      return <p className="text-sm text-red-600">Failed to load overview: {error.message}</p>;
    }
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const { counts, plc, lastReport, warnings } = data;

  return (
    <div className="space-y-5">
      {warnings && warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Data health
          </div>
          <ul className="mt-1 list-inside list-disc text-sm text-amber-700">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Users" value={counts.users} icon={Users} />
        <StatCard title="Projects" value={counts.projects} icon={FolderKanban} tone="slate" />
        <StatCard title="Items" value={counts.items} icon={Package} tone="slate" />
        <StatCard title="Checkouts" value={counts.checkouts} icon={ClipboardList} tone="green" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="PLC Bridge">
          <div className="flex items-center gap-3">
            <Cpu className="h-8 w-8 text-slate-400" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Badge tone={plc.connected ? "green" : "red"}>
                  {plc.connected ? "Connected" : "Disconnected"}
                </Badge>
                {plc.mode === "sim" && <Badge tone="amber">Simulation</Badge>}
                {plc.mode === "real" && <Badge tone="brand">Live PLC</Badge>}
              </div>
              <p className="mt-1 text-xs text-slate-400">Mode: {plc.mode}</p>
            </div>
          </div>
        </Card>

        <Card title="Weekly report">
          {lastReport ? (
            <div className="text-sm">
              <div className="flex items-center gap-2">
                <Badge tone={lastReport.success ? "green" : "red"}>
                  {lastReport.success ? "Succeeded" : "Failed"}
                </Badge>
                <span className="text-slate-500">{formatDateTime(lastReport.ran_at)}</span>
              </div>
              {!lastReport.success && lastReport.error_message && (
                <p className="mt-2 text-xs text-red-600">{lastReport.error_message}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No weekly report has run yet.</p>
          )}
        </Card>
      </div>

      <p className="text-center text-xs text-slate-400">Sparky Cart · version {version}</p>
    </div>
  );
}
