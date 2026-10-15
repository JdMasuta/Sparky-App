// App container supervisor (#25). Runs the PLC bridge and the backend as child
// processes and implements the app side of the update handover:
//
//   standby (new container):  preflight -> wait for the old container's ack
//                              -> start services
//   active  (old container):  release (drain) -> commit (graceful stop,
//                              DB snapshot, ack to successor) or resume
//
// Docker's restart policy replaces sparky.bat's supervise loop: if a service
// dies while active, the supervisor exits non-zero and Docker restarts the
// container. The handover listener binds to the control-network address only
// (see handover.mjs pickBindAddress), never the LAN-facing network.
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, fork } from "node:child_process";
import { promises as fs, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as H from "./handover.mjs";
import { preflight } from "./preflight.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "../..");
const env = process.env;

const cfg = {
  name: env.SPARKY_CONTAINER_NAME || os.hostname(),
  standby: env.SPARKY_STANDBY === "1",
  predecessor: env.SPARKY_PREDECESSOR || "",
  handoverToken: env.SPARKY_HANDOVER_TOKEN || "",
  orchToken: env.SPARKY_ORCH_TOKEN || "",
  controlSubnet: env.SPARKY_CONTROL_SUBNET || "",
  handoverPort: Number(env.SPARKY_HANDOVER_PORT || 3100),
  ackTimeoutMs: Number(env.SPARKY_ACK_TIMEOUT_MS || 900_000),
  failSafeMs: Number(env.SPARKY_COMMIT_FAILSAFE_MS || 60_000),
  startTimeoutMs: Number(env.SPARKY_START_TIMEOUT_MS || 60_000),
  stopTimeoutMs: Number(env.SPARKY_STOP_TIMEOUT_MS || 25_000),
  dataDir: env.SPARKY_DATA_DIR || "/data",
  dbFile: env.SPARKY_DB_FILE || "prod.sqlite",
  port: Number(env.PORT || 3000),
  bridgePort: Number(env.BRIDGE_PORT || 8000),
  phaseFile: env.SPARKY_PHASE_FILE || "/tmp/sparky-phase",
};

const version = JSON.parse(readFileSync(path.join(APP_ROOT, "package.json"), "utf8")).version;
const { LATEST_MIGRATION } = await import(
  pathToFileURL(path.join(APP_ROOT, "backend/src/init/migrations.js")).href
);

// Children don't need the per-update handshake secret.
const childEnv = { ...env };
delete childEnv.SPARKY_HANDOVER_TOKEN;

const log = (msg) => console.log(`[supervisor] ${msg}`);

const state = {
  phase: H.initialPhase(cfg.standby),
  lastRelease: null,
  drain: { activeMonitors: null, step: null },
  release: null,
  error: null,
};
let bridge = null;
let backend = null;
let intentionalStop = false;
let pendingDrain = null;
let failSafeTimer = null;
let ackTimer = null;

function setPhase(next) {
  state.phase = next;
  try {
    writeFileSync(cfg.phaseFile, next);
  } catch {
    /* the phase file only feeds the Docker healthcheck */
  }
  log(`phase -> ${next}`);
}
const fire = (event) => setPhase(H.transition(state.phase, event));
setPhase(state.phase);

// ---- child processes --------------------------------------------------------
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function onChildExit(label) {
  return (code, signal) => {
    log(`${label} exited (code ${code}, signal ${signal})`);
    if (intentionalStop) return;
    if (["active", "draining", "drained"].includes(state.phase)) {
      log(`${label} died unexpectedly; exiting so Docker restarts the container`);
      stopChildren().finally(() => process.exit(1));
    }
  };
}

async function waitFor(check, child, label) {
  const deadline = Date.now() + cfg.startTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${label} exited during startup`);
    if (await check()) return;
    await delay(250);
  }
  throw new Error(`${label} did not become ready within ${cfg.startTimeoutMs} ms`);
}

const tcpOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });

const httpOk = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
};

async function startServices() {
  intentionalStop = false;
  bridge = spawn(process.execPath, [path.join(APP_ROOT, "microservice/src/server.js")], {
    cwd: APP_ROOT,
    env: childEnv,
    stdio: "inherit",
  });
  bridge.on("exit", onChildExit("bridge"));
  await waitFor(() => tcpOpen(cfg.bridgePort), bridge, "PLC bridge");

  backend = fork(path.join(APP_ROOT, "backend/src/server.js"), [], {
    cwd: APP_ROOT,
    env: childEnv,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  backend.on("exit", onChildExit("backend"));
  backend.on("message", onBackendMessage);
  await waitFor(() => httpOk(`http://127.0.0.1:${cfg.port}/health`), backend, "backend");
}

function waitExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(child?.exitCode ?? 0);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      log(`pid ${child.pid} did not exit in ${timeoutMs} ms; killing`);
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** Graceful stop: backend first (closes HTTP then DB), then the bridge. */
async function stopChildren() {
  intentionalStop = true;
  let backendCode = 0;
  if (backend && backend.exitCode === null && backend.signalCode === null) {
    if (backend.connected) backend.send({ type: "shutdown" });
    else backend.kill("SIGTERM");
    backendCode = await waitExit(backend, cfg.stopTimeoutMs);
  }
  let bridgeCode = 0;
  if (bridge && bridge.exitCode === null && bridge.signalCode === null) {
    bridge.kill("SIGTERM");
    bridgeCode = await waitExit(bridge, cfg.stopTimeoutMs);
  }
  return { backendCode, bridgeCode };
}

function onBackendMessage(msg) {
  if (msg?.type === "drain-result" && pendingDrain) {
    const resolve = pendingDrain;
    pendingDrain = null;
    resolve(msg);
  }
}

// ---- handover actions -------------------------------------------------------
async function runStandby() {
  const result = await preflight({ dataDir: cfg.dataDir, dbFile: cfg.dbFile, env });
  if (!result.ok) {
    state.error = result.errors.join("; ");
    fire("preflight-fail");
    log(`preflight failed: ${state.error}`);
    // Stay readable briefly so the orchestrator can fetch the reason, then exit.
    setTimeout(() => process.exit(1), 10_000).unref();
    return;
  }
  fire("preflight-ok");
  ackTimer = setTimeout(() => {
    log(`no handover ack within ${cfg.ackTimeoutMs} ms; exiting`);
    process.exit(1);
  }, cfg.ackTimeoutMs);
}

async function startAfterHandshake() {
  try {
    await startServices();
    fire("started");
  } catch (err) {
    state.error = err.message;
    log(`start failed: ${err.message}`);
    await stopChildren();
    fire("start-fail");
  }
}

async function release(value) {
  state.release = value;
  state.lastRelease = { updateId: value.updateId, result: "draining", at: new Date().toISOString() };
  const result = await new Promise((resolve) => {
    pendingDrain = resolve;
    backend.send({ type: "drain", deadlineMs: value.drainTimeoutMs });
  });
  if (state.phase !== "draining") return; // resumed meanwhile
  state.drain = { activeMonitors: result.activeMonitors, step: result.step };
  if (result.result === "drained") {
    fire("drained");
    state.lastRelease.result = "drained";
    failSafeTimer = setTimeout(() => {
      if (state.phase === "drained") resume("fail-safe");
    }, cfg.failSafeMs);
  } else if (result.result === "timeout") {
    fire("drain-timeout");
    state.lastRelease.result = "drain-timeout";
  }
}

function resume(reason) {
  fire("resume"); // throws (-> 409) unless draining or drained
  clearTimeout(failSafeTimer);
  if (backend?.connected) backend.send({ type: "resume" });
  if (state.lastRelease) state.lastRelease.result = reason;
  log(`drain resumed (${reason})`);
}

async function takeSnapshot(updateId) {
  const dir = path.join(cfg.dataDir, "backups");
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, H.snapshotName(updateId));
  await fs.copyFile(path.join(cfg.dataDir, cfg.dbFile), dest);
  const fh = await fs.open(dest, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
  return dest;
}

async function sendAck(successor, ack) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`http://${successor}:${cfg.handoverPort}/handover/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ack),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return true;
      log(`ack attempt ${attempt} rejected: HTTP ${res.status}`);
    } catch (err) {
      log(`ack attempt ${attempt} failed: ${err.message}`);
    }
    await delay(2000);
  }
  return false;
}

async function commit() {
  clearTimeout(failSafeTimer);
  const { updateId, updateToken, successor } = state.release;
  const { backendCode, bridgeCode } = await stopChildren();
  const cleanShutdown = backendCode === 0 && bridgeCode === 0;
  let snapshot = null;
  try {
    snapshot = await takeSnapshot(updateId);
  } catch (err) {
    log(`DB snapshot failed: ${err.message}`);
  }
  const acked =
    snapshot !== null &&
    (await sendAck(
      successor,
      H.buildAck({ updateId, updateToken, name: cfg.name, version, snapshot, cleanShutdown }),
    ));
  if (acked) {
    fire("released");
    state.lastRelease = { ...state.lastRelease, result: "handed-over", snapshot, cleanShutdown };
    return;
  }
  // Successor never confirmed: bring our own services back.
  state.lastRelease = { ...state.lastRelease, result: snapshot ? "ack-failed" : "snapshot-failed" };
  fire("ack-failed");
  try {
    await startServices();
    fire("started");
  } catch (err) {
    state.error = err.message;
    await stopChildren();
    fire("start-fail");
  }
}

// ---- handover HTTP API --------------------------------------------------------
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 16_384) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

function publicState() {
  return {
    protocol: H.PROTOCOL,
    phase: state.phase,
    name: cfg.name,
    version,
    schemaVersion: LATEST_MIGRATION,
    activeMonitors: state.drain.activeMonitors,
    step: state.drain.step,
    lastRelease: state.lastRelease,
    error: state.error,
  };
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/handover/state") return send(res, 200, publicState());
  if (req.method !== "POST") return send(res, 404, { error: "Not found" });

  if (url.pathname === "/handover/ack") {
    const body = await readJson(req);
    if (state.phase !== "standby-ready") return send(res, 409, { error: `Not waiting for an ack (phase ${state.phase})` });
    const v = H.validateAck(body, { expectedToken: cfg.handoverToken, predecessor: cfg.predecessor });
    if (!v.ok) return send(res, v.status, { error: v.error });
    clearTimeout(ackTimer);
    fire("ack");
    log(`handover ack from ${v.value.from.name} ${v.value.from.version} (clean=${v.value.cleanShutdown})`);
    send(res, 200, { accepted: true });
    startAfterHandshake();
    return;
  }

  // Everything else comes from the orchestrator and needs this container's token.
  if (!H.bearerMatches(req.headers.authorization, cfg.orchToken)) return send(res, 401, { error: "Unauthorized" });

  if (url.pathname === "/handover/release") {
    const v = H.validateRelease(await readJson(req));
    if (!v.ok) return send(res, v.status, { error: v.error });
    fire("release");
    send(res, 202, { phase: state.phase });
    release(v.value).catch((err) => log(`release failed: ${err.message}`));
    return;
  }
  if (url.pathname === "/handover/resume") {
    resume("resumed");
    return send(res, 200, { phase: state.phase });
  }
  if (url.pathname === "/handover/commit") {
    fire("commit");
    send(res, 202, { phase: state.phase });
    commit().catch((err) => log(`commit failed: ${err.message}`));
    return;
  }
  send(res, 404, { error: "Not found" });
}

const bindAddress = H.pickBindAddress(os.networkInterfaces(), cfg.controlSubnet);
const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (!res.headersSent) send(res, err.status || 500, { error: err.message });
  });
});
server.listen(cfg.handoverPort, bindAddress, () =>
  log(`${cfg.name} v${version} handover API on ${bindAddress}:${cfg.handoverPort}`),
);

// ---- signals --------------------------------------------------------------
let exiting = false;
async function onSignal(signal) {
  if (exiting) return;
  exiting = true;
  log(`${signal} received; stopping services`);
  clearTimeout(ackTimer);
  clearTimeout(failSafeTimer);
  const { backendCode, bridgeCode } = await stopChildren();
  server.close();
  process.exit(backendCode === 0 && bridgeCode === 0 ? 0 : 1);
}
process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("SIGINT", () => onSignal("SIGINT"));

// ---- boot ---------------------------------------------------------------------
if (cfg.standby) {
  runStandby().catch((err) => {
    log(`standby failed: ${err.message}`);
    process.exit(1);
  });
} else {
  startServices()
    .then(() => fire("started"))
    .catch(async (err) => {
      log(`start failed: ${err.message}`);
      await stopChildren();
      process.exit(1);
    });
}
