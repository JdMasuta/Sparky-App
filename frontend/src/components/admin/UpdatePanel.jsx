// Container-deployment updates (#25). Updates are queued with the orchestrator
// and run only inside the update window (device time). The old version drains
// in-flight checkouts (up to 10 min, then the update postpones itself) before
// handing over to the new one. Progress comes from /__edge/status, served by
// the edge proxy, so it keeps working while the app itself restarts.
import { useCallback, useEffect, useRef, useState } from "react";
import { DownloadCloud, XCircle, CheckCircle2, Circle, Loader2 } from "lucide-react";
import Button from "../ui/Button.jsx";
import Badge from "../ui/Badge.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import useAlerts from "../shared/Alerts/useAlerts.jsx";
import { api } from "../../lib/api.js";

const STEPS = [
  { phase: "queued", label: "Queued" },
  { phase: "preparing", label: "Preparing" },
  { phase: "standby", label: "New version standing by" },
  { phase: "draining", label: "Waiting for checkouts" },
  { phase: "committed", label: "Handing over" },
  { phase: "starting", label: "Starting new version" },
  { phase: "verifying", label: "Verifying" },
  { phase: "done", label: "Done" },
];
const STEP_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.phase, i]));
const WAITING = ["queued", "postponed"];
const RUNNING = ["preparing", "standby", "draining", "committed", "starting", "verifying"];
const CANCELABLE = [...WAITING, "preparing", "standby", "draining"];
const OUTCOME = {
  done: { tone: "green", text: "Update complete" },
  postponed: { tone: "amber", text: "Update postponed" },
  "rolled-back": { tone: "red", text: "Update rolled back" },
  failed: { tone: "red", text: "Update failed" },
  canceled: { tone: "neutral", text: "Update canceled" },
};

/** Format an ISO time in the device's time zone. */
function deviceTime(iso, tz) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

async function fetchEdgeStatus() {
  const res = await fetch("/__edge/status", { cache: "no-store" });
  if (!res.ok) throw new Error(`Status unavailable (HTTP ${res.status})`);
  return res.json();
}

export default function UpdatePanel({ productVersion }) {
  const { addAlert } = useAlerts();
  const [check, setCheck] = useState(null);
  const [checkError, setCheckError] = useState(null);
  const [status, setStatus] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const reloadScheduled = useRef(false);

  const phase = status?.phase ?? check?.update?.phase ?? "idle";
  const windowInfo = status?.window ?? check?.window ?? null;
  const tz = windowInfo?.tz;

  const loadCheck = useCallback(async () => {
    try {
      setCheck(await api.get("/system/update/check"));
      setCheckError(null);
    } catch (err) {
      setCheckError(err.message);
    }
  }, []);

  useEffect(() => {
    loadCheck();
  }, [loadCheck]);

  // Poll the edge status: fast while an update runs, slowly otherwise.
  useEffect(() => {
    let stopped = false;
    let timer;
    const poll = async () => {
      let next = 15_000;
      try {
        const s = await fetchEdgeStatus();
        if (stopped) return;
        setStatus(s);
        if (RUNNING.includes(s.phase)) next = 2_000;
      } catch {
        next = 2_000; // proxy briefly unreachable: keep trying
      }
      if (!stopped) timer = setTimeout(poll, next);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  // A finished update ships a new frontend: reload once the new version serves.
  // At most once per update (sessionStorage), so a version mismatch can never
  // cause a reload loop.
  useEffect(() => {
    if (phase !== "done" || !status?.to || status.to === productVersion || reloadScheduled.current) return;
    const key = `sparky-reloaded-${status.updateId}`;
    if (sessionStorage.getItem(key)) return;
    reloadScheduled.current = true;
    sessionStorage.setItem(key, "1");
    addAlert({ message: `Updated to ${status.to}. Reloading…`, severity: "success", timeout: 3 });
    setTimeout(() => window.location.reload(), 3000);
  }, [phase, status?.to, status?.updateId, productVersion, addAlert]);

  const queue = async () => {
    setBusy(true);
    try {
      const res = await api.post("/system/update");
      addAlert({
        message: windowInfo?.open
          ? "Update started."
          : `Update queued. It will run after ${deviceTime(res.notBefore, tz)} (device time).`,
        severity: "info",
        timeout: 6,
      });
      setStatus(await fetchEdgeStatus().catch(() => status));
      loadCheck();
    } catch (err) {
      addAlert({ message: err.message, severity: err.status === 409 ? "warning" : "error", timeout: 8 });
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      const res = await api.del("/system/update");
      addAlert({
        message: res.state === "canceling" ? "Canceling; the running version keeps serving." : "Update canceled.",
        severity: "info",
        timeout: 5,
      });
      setStatus(await fetchEdgeStatus().catch(() => status));
    } catch (err) {
      addAlert({ message: err.message, severity: "error", timeout: 8 });
    } finally {
      setBusy(false);
    }
  };

  const latest = check?.latest?.version;
  const available = !!check?.available;
  const inProgress = WAITING.includes(phase) || RUNNING.includes(phase);
  const outcome = OUTCOME[phase];
  const activeMonitors = check?.activeMonitors ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        {latest ? (
          available ? (
            <Badge tone="brand">Version {latest} available</Badge>
          ) : (
            <Badge tone="green">Up to date</Badge>
          )
        ) : (
          <span className="text-slate-400">
            {checkError || check?.latestError ? "Latest release unavailable" : "Checking for updates…"}
          </span>
        )}
        {activeMonitors > 0 && <Badge tone="amber">{activeMonitors} checkout(s) in progress</Badge>}
      </div>

      {windowInfo && (
        <p className="text-xs text-slate-500">
          Updates run {windowInfo.spec.replace("-", "–")} device time ({windowInfo.tz}).{" "}
          {windowInfo.open ? "The window is open now." : `Next window opens ${deviceTime(windowInfo.nextOpen, tz)}.`}
        </p>
      )}

      {inProgress && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          {WAITING.includes(phase) ? (
            <p className="text-sm text-slate-700">
              {phase === "postponed" ? "Postponed" : "Queued"}: {status?.from} → {status?.to}, runs after{" "}
              {deviceTime(status?.notBefore, tz)} (device time).
              {status?.attempts > 0 && <span className="text-slate-500"> Attempts: {status.attempts}.</span>}
            </p>
          ) : (
            <ol className="space-y-1">
              {STEPS.map((step, i) => {
                const current = STEP_INDEX[phase];
                const Icon = i < current ? CheckCircle2 : i === current ? Loader2 : Circle;
                return (
                  <li
                    key={step.phase}
                    className={`flex items-center gap-2 text-sm ${i <= current ? "text-slate-700" : "text-slate-400"}`}
                  >
                    <Icon className={`h-4 w-4 ${i === current ? "animate-spin text-brand-600" : ""}`} />
                    {step.label}
                  </li>
                );
              })}
            </ol>
          )}
          {status?.lastReason && <p className="mt-2 text-xs text-slate-500">{status.lastReason}</p>}
        </div>
      )}

      {outcome && phase !== "done" && (
        <div className="rounded-lg border border-slate-200 p-3 text-sm">
          <Badge tone={outcome.tone}>{outcome.text}</Badge>
          {status?.lastReason && <p className="mt-2 text-slate-600">{status.lastReason}</p>}
        </div>
      )}
      {phase === "done" && status?.to && <Badge tone="green">Updated to {status.to}</Badge>}

      <div className="flex flex-wrap gap-2">
        {!inProgress && (
          <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={!available || busy}>
            <DownloadCloud className="h-4 w-4" /> {windowInfo?.open ? "Update now" : "Queue update"}
          </Button>
        )}
        {CANCELABLE.includes(phase) && (
          <Button size="sm" variant="secondary" onClick={cancel} disabled={busy}>
            <XCircle className="h-4 w-4" /> {WAITING.includes(phase) ? "Cancel queued update" : "Cancel update"}
          </Button>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={queue}
        busy={busy}
        variant="primary"
        title={windowInfo?.open ? `Update to ${latest}?` : `Queue the update to ${latest}?`}
        confirmLabel={windowInfo?.open ? "Update now" : "Queue update"}
        message={
          `${windowInfo?.open ? "The update starts now." : `The update runs when the window opens (${deviceTime(windowInfo?.nextOpen, tz)}).`} ` +
          "New checkouts pause while the current version waits up to 10 minutes for checkouts in progress to finish; " +
          "if any are still running, the update postpones itself and the current version keeps serving. " +
          "If the new version fails its health check, the previous version is restored automatically."
        }
      />
    </div>
  );
}
