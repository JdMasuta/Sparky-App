// Edge entry point (#25): one image, two edge roles.
//
//   node deploy/edge/edge.mjs --role=proxy         LAN-facing proxy (no secrets)
//   node deploy/edge/edge.mjs --role=orchestrator  update orchestrator (docker.sock)
//
// Configuration comes from the environment (compose --env-file edge.env):
//   proxy:        SPARKY_ROUTE_DIR (/route), SPARKY_PROXY_PORT (3000)
//   orchestrator: SPARKY_TZ, SPARKY_CONTROL_SUBNET, SPARKY_APP_IMAGE,
//                 SPARKY_IMAGE_REPO, SPARKY_RELEASE_REPO, SPARKY_UPDATE_MANIFEST_URL,
//                 SPARKY_UPDATE_WINDOW, SPARKY_DRAIN_TIMEOUT_MS, SPARKY_BACKUP_HOST_DIR,
//                 SPARKY_ORCH_URL, SPARKY_STATE_DIR (/state), SPARKY_ROUTE_DIR (/route),
//                 SPARKY_SCHED_TICK_MS (30000), DOCKER_SOCKET
import os from "node:os";
import { createProxy } from "./proxy.mjs";
import { createDockerClient } from "./docker-api.mjs";
import { createStore } from "./state.mjs";
import { createReleaseSource } from "./release-source.mjs";
import { createOrchestrator, DEFAULT_CONFIG } from "./orchestrator.mjs";
import { createControlServer } from "./control-server.mjs";
import { pickBindAddress } from "../container/handover.mjs";

const env = process.env;
const role = (process.argv.find((a) => a.startsWith("--role=")) || "").slice("--role=".length);
const num = (value, fallback) => (value === undefined || value === "" ? fallback : Number(value));

function onSignals(close) {
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      close();
      process.exit(0);
    });
  }
}

async function runProxy() {
  const log = (msg) => console.log(`[proxy] ${msg}`);
  const port = num(env.SPARKY_PROXY_PORT, 3000);
  const server = createProxy({ routeDir: env.SPARKY_ROUTE_DIR || "/route", log });
  server.listen(port, "0.0.0.0", () => log(`listening on :${port}`));
  onSignals(() => server.close());
}

async function runOrchestrator() {
  const log = (msg) => console.log(`[orchestrator] ${msg}`);
  for (const key of ["SPARKY_TZ", "SPARKY_CONTROL_SUBNET"]) {
    if (!env[key]) throw new Error(`${key} is not set (edge.env)`);
  }
  const orchestrator = createOrchestrator({
    docker: createDockerClient({ socketPath: env.DOCKER_SOCKET || "/var/run/docker.sock" }),
    store: createStore({ stateDir: env.SPARKY_STATE_DIR || "/state", routeDir: env.SPARKY_ROUTE_DIR || "/route" }),
    releaseSource: createReleaseSource({
      imageRepo: env.SPARKY_IMAGE_REPO || "ghcr.io/jdmasuta/sparky-app",
      releaseRepo: env.SPARKY_RELEASE_REPO || "JdMasuta/Sparky-App",
      manifestUrl: env.SPARKY_UPDATE_MANIFEST_URL || "",
    }),
    config: {
      tz: env.SPARKY_TZ,
      controlSubnet: env.SPARKY_CONTROL_SUBNET,
      initialImage: env.SPARKY_APP_IMAGE || "",
      window: env.SPARKY_UPDATE_WINDOW || DEFAULT_CONFIG.window,
      drainTimeoutMs: num(env.SPARKY_DRAIN_TIMEOUT_MS, DEFAULT_CONFIG.drainTimeoutMs),
      retryMs: num(env.SPARKY_RETRY_MS, DEFAULT_CONFIG.retryMs),
      verifyHoldMs: num(env.SPARKY_VERIFY_HOLD_MS, DEFAULT_CONFIG.verifyHoldMs),
      backupHostDir: env.SPARKY_BACKUP_HOST_DIR || "",
      orchUrl: env.SPARKY_ORCH_URL || DEFAULT_CONFIG.orchUrl,
    },
    log,
  });
  await orchestrator.init();

  const port = num(env.SPARKY_CONTROL_PORT, 3200);
  const address = pickBindAddress(os.networkInterfaces(), env.SPARKY_CONTROL_SUBNET);
  const server = createControlServer({ orchestrator, log });
  server.listen(port, address, () => log(`control API on ${address}:${port}`));

  const tickMs = num(env.SPARKY_SCHED_TICK_MS, 30_000);
  let ticking = false;
  const timer = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      await orchestrator.tick();
    } catch (err) {
      log(`scheduler: ${err.stack || err.message}`);
    } finally {
      ticking = false;
    }
  }, tickMs);
  onSignals(() => {
    clearInterval(timer);
    server.close();
  });
}

const roles = { proxy: runProxy, orchestrator: runOrchestrator };
if (!roles[role]) {
  console.error(`Usage: node deploy/edge/edge.mjs --role=${Object.keys(roles).join("|")}`);
  process.exit(2);
}
roles[role]().catch((err) => {
  console.error(`[${role}] fatal: ${err.stack || err.message}`);
  process.exit(1);
});
