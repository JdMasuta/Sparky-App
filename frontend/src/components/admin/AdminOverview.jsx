/* global __APP_VERSION__ */
import { useEffect, useState } from "react";
import { Users, FolderKanban, Package, ClipboardList, Cpu } from "lucide-react";
import StatCard from "../ui/StatCard.jsx";
import Card from "../ui/Card.jsx";
import Badge from "../ui/Badge.jsx";
import Spinner from "../ui/Spinner.jsx";
import { api } from "../../lib/api.js";
import { formatDateTime } from "../../lib/tableSchemas.js";

const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

export default function AdminOverview() {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [users, projects, items, checkouts, plc, reports] = await Promise.all([
          api.get("/users"),
          api.get("/projects"),
          api.get("/items"),
          api.get("/checkouts"),
          api.get("/pull/status").catch(() => ({ connected: false, mode: "unknown" })),
          api.get("/weekly_report_status").catch(() => []),
        ]);
        if (!alive) return;
        const lastReport = reports[reports.length - 1];
        setState({
          loading: false,
          counts: {
            users: users.length,
            projects: projects.length,
            items: items.length,
            checkouts: checkouts.length,
          },
          plc,
          lastReport,
        });
      } catch (err) {
        if (alive) setState({ loading: false, error: err.message });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state.loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (state.error) {
    return <p className="text-sm text-red-600">Failed to load overview: {state.error}</p>;
  }

  const { counts, plc, lastReport } = state;

  return (
    <div className="space-y-5">
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
