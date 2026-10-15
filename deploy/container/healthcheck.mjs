// Docker HEALTHCHECK for the app container. Standby and handover phases are
// healthy for their role (services are intentionally down); an active
// container must answer /health. The orchestrator runs its own, stricter
// checks — this only feeds `docker ps` and status tooling.
import { readFileSync } from "node:fs";

const HEALTHY_WITHOUT_HTTP = new Set([
  "preflight",
  "standby-ready",
  "starting",
  "stopping",
  "released",
]);

let phase = "";
try {
  phase = readFileSync(process.env.SPARKY_PHASE_FILE || "/tmp/sparky-phase", "utf8").trim();
} catch {
  process.exit(1);
}

if (HEALTHY_WITHOUT_HTTP.has(phase)) process.exit(0);
if (!["active", "draining", "drained"].includes(phase)) process.exit(1);

try {
  const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/health`, {
    signal: AbortSignal.timeout(3000),
  });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
