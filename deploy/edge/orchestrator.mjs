// Update orchestrator (#25): the trusted core. It holds docker.sock, is never
// LAN-facing, and is the only component that creates, promotes, rolls back or
// removes app containers. Protocol and rules: see the plan's "Update protocol"
// and SECURITY.md. All I/O is injected so the state machine is unit-tested.
//
// Update lifecycle (state.update.phase):
//   queued/postponed -> preparing -> standby -> draining -> committed
//     -> starting -> verifying -> done | rolled-back
//   plus terminal failed / canceled.
// Window gates: before preparing (1), before release (2), throughout the drain
// (3), after the drain and before commit (4). After commit nothing aborts the
// handover — it finishes even if that runs past the end of the window.
import { PROTOCOL } from "../container/handover.mjs";
import { isNewer } from "../updater.mjs";
import { parseWindow, assertTimeZone, isOpen, nextOpen, describeWindow } from "./update-window.mjs";
import { newSecret, randomToken, tokenFor, authorize } from "./auth.mjs";
import {
  APP_PORT,
  HANDOVER_PORT,
  DATA_VOLUME,
  DEFAULT_NETWORKS,
  appContainerName,
  buildAppContainerSpec,
  buildRestoreHelperSpec,
} from "./app-spec.mjs";
import { parseImageRef } from "./release-source.mjs";
import { reconcile, PRE_COMMIT } from "./reconcile.mjs";

export const WAITING = Object.freeze(["queued", "postponed"]);
export const TERMINAL = Object.freeze(["done", "failed", "rolled-back", "canceled"]);

const httpError = (status, message) => Object.assign(new Error(message), { status });
const iso = (ms) => new Date(ms).toISOString();
const tail = (text, lines = 200) => String(text || "").split("\n").slice(-lines).join("\n");

export const DEFAULT_CONFIG = Object.freeze({
  window: "17:00-03:00",
  drainTimeoutMs: 600_000, // decided: 10 min, then postpone
  retryMs: 900_000, // postponed updates retry after 15 min while the window is open
  preflightTimeoutMs: 120_000,
  handoverTimeoutMs: 300_000, // commit -> new container active
  verifyHoldMs: 10_000,
  verifyTimeoutMs: 90_000,
  pollMs: 2_000,
  lostContactMs: 30_000,
  orchUrl: "http://sparky-orchestrator:3200",
  backupHostDir: "",
  networks: DEFAULT_NETWORKS,
  dataVolume: DATA_VOLUME,
});

/**
 * @param {object} deps
 * @param {ReturnType<import("./docker-api.mjs").createDockerClient>} deps.docker
 * @param {ReturnType<import("./state.mjs").createStore>} deps.store
 * @param {{ latest(): Promise<{version: string, image: string, repo: string, digest: string}> }} deps.releaseSource
 * @param {object} deps.config  see DEFAULT_CONFIG; also tz, controlSubnet, initialImage
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => number} [deps.now]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {(bytes: number) => string} [deps.random] hex string of `bytes` random bytes
 * @param {(msg: string) => void} [deps.log]
 */
export function createOrchestrator({
  docker,
  store,
  releaseSource,
  config: userConfig,
  fetchImpl = fetch,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  random = randomToken,
  log = (msg) => console.log(`[orchestrator] ${msg}`),
}) {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  const win = parseWindow(config.window);
  assertTimeZone(config.tz);
  if (!config.controlSubnet) throw new Error("orchestrator: controlSubnet is required");

  let state = null;
  let running = null; // in-flight runUpdate promise
  let prepping = null; // background image pull for a queued update

  const open = (ms = now()) => isOpen(new Date(ms), win, config.tz);
  const nextOpenAt = (ms = now()) => nextOpen(new Date(ms), win, config.tz).getTime();

  // ---- persistence ----------------------------------------------------------
  function statusView() {
    const u = state?.update;
    return {
      phase: u?.phase ?? "idle",
      updateId: u?.id ?? null,
      from: u?.from ?? state?.active?.version ?? null,
      to: u?.target?.version ?? null,
      notBefore: u?.notBefore ?? null,
      attempts: u?.attempts ?? 0,
      lastReason: u?.lastReason ?? null,
      current: state?.active ? { version: state.active.version } : null,
      window: describeWindow(new Date(now()), win, config.tz),
      updatedAt: iso(now()),
    };
  }

  async function save() {
    await store.save(state);
    await store.writeStatus(statusView());
  }

  async function writeRoute() {
    await store.writeRoute(
      state.active
        ? { name: state.active.name, port: APP_PORT, updatedAt: iso(now()) }
        : { name: null, port: null, updatedAt: iso(now()) },
    );
  }

  async function setPhase(u, phase, reason) {
    u.phase = phase;
    if (reason !== undefined) u.lastReason = reason;
    log(`update ${u.id}: ${phase}${reason ? ` (${reason})` : ""}`);
    await save();
  }

  async function finish(u, phase, reason) {
    u.phase = phase;
    u.lastReason = reason ?? null;
    u.standbyName = null;
    u.handoverToken = null;
    u.finishedAt = iso(now());
    state.history = [
      ...(state.history || []),
      { id: u.id, from: u.from, to: u.target?.version, result: phase, reason: u.lastReason, at: u.finishedAt },
    ].slice(-20);
    log(`update ${u.id}: ${phase}${reason ? ` (${reason})` : ""}`);
    await save();
  }

  // ---- docker helpers -------------------------------------------------------
  async function removeApp(name) {
    if (!name) return;
    try {
      await docker.containerStop(name, 30);
    } catch (err) {
      log(`stop ${name}: ${err.message}`);
    }
    try {
      await docker.containerRemove(name);
    } catch (err) {
      log(`remove ${name}: ${err.message}`);
    }
  }

  async function ensureRunning(name) {
    const info = await docker.containerInspect(name);
    if (info && !info.State?.Running) await docker.containerStart(name);
    return !!info;
  }

  const setRestart = (name, policy) => docker.containerUpdate(name, { RestartPolicy: { Name: policy } });

  async function createApp(name, { image, version, standby }) {
    const spec = buildAppContainerSpec({
      image,
      name,
      version,
      tz: config.tz,
      orchUrl: config.orchUrl,
      orchToken: tokenFor(state.secret, name),
      controlSubnet: config.controlSubnet,
      backupHostDir: config.backupHostDir,
      standby,
      networks: config.networks,
      dataVolume: config.dataVolume,
    });
    const id = await docker.containerCreate(name, spec.create);
    for (const network of spec.extraNetworks) await docker.networkConnect(network, id);
    await docker.containerStart(id);
    return name;
  }

  /** Pull if needed, then require the manifest's digest and version on the image. */
  async function ensureImage(target) {
    let info = await docker.imageInspect(target.image);
    if (!info) {
      log(`pulling ${target.image}`);
      await docker.imagePull(target.image);
      info = await docker.imageInspect(target.image);
    }
    if (!info) throw new Error(`Image ${target.image} is not available after pulling`);
    if (!(info.RepoDigests || []).includes(`${target.repo}@${target.digest}`)) {
      throw new Error(`Image digest does not match the release manifest (${target.digest})`);
    }
    const label = info.Config?.Labels?.["org.opencontainers.image.version"];
    if (label !== target.version) {
      throw new Error(`Image version label "${label}" does not match release ${target.version}`);
    }
  }

  async function bootstrap(image, knownVersion) {
    let info = await docker.imageInspect(image);
    if (!info) {
      log(`pulling ${image}`);
      await docker.imagePull(image);
      info = await docker.imageInspect(image);
    }
    const version = info?.Config?.Labels?.["org.opencontainers.image.version"] || knownVersion || "unknown";
    const name = appContainerName(version, random(3));
    await createApp(name, { image, version, standby: null });
    state.active = { name, image, digest: parseImageRef(image).digest, version };
    log(`started ${name} from ${image}`);
  }

  /** Run the OLD image's restore helper. 0 restored, 3 no snapshot, else failed. */
  async function restoreSnapshot(updateId, image) {
    const name = `sparky-restore-${updateId}`;
    await docker.containerRemove(name).catch(() => {});
    const id = await docker.containerCreate(name, buildRestoreHelperSpec({ image, updateId, dataVolume: config.dataVolume }));
    try {
      await docker.containerStart(id);
      const code = await docker.containerWait(id);
      if (code !== 0 && code !== 3) log(`snapshot restore failed (${code}): ${tail(await docker.containerLogs(id, 20), 20)}`);
      return code;
    } finally {
      await docker.containerRemove(id).catch(() => {});
    }
  }

  /**
   * Put the pre-update DB snapshot back before the old version starts again.
   * Skipped when the old container is still serving (it never released the
   * DB, so the snapshot would discard its newer writes). Stops it first so
   * nothing has the DB open during the restore.
   * @returns {Promise<{note: string, serving: boolean}>} note for the status
   *   reason ("" when restored); serving=true when the restore was skipped
   */
  async function rollbackDatabase(oldName, image, updateId) {
    if (oldName) {
      const st = await getAppState(oldName);
      if (st?.phase === "active") {
        log(`${oldName} is still serving; keeping its database`);
        return { note: "", serving: true };
      }
      await docker.containerStop(oldName, 30).catch((err) => log(`stop ${oldName}: ${err.message}`));
    }
    const code = await restoreSnapshot(updateId, image).catch((err) => {
      log(`snapshot restore: ${err.message}`);
      return -1;
    });
    if (code === 0) return { note: "", serving: false };
    if (code === 3) return { note: " (no DB snapshot was found)", serving: false };
    return { note: " (DB snapshot restore FAILED — check the database)", serving: false };
  }

  // ---- handover HTTP --------------------------------------------------------
  const handoverUrl = (name, path) => `http://${name}:${HANDOVER_PORT}${path}`;

  async function getAppState(name) {
    try {
      const res = await fetchImpl(handoverUrl(name, "/handover/state"), { signal: AbortSignal.timeout(5000) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  async function postHandover(name, path, body) {
    const res = await fetchImpl(handoverUrl(name, path), {
      method: "POST",
      headers: { authorization: `Bearer ${tokenFor(state.secret, name)}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw httpError(res.status, `${path} on ${name}: HTTP ${res.status} ${await res.text().catch(() => "")}`);
    return res.json().catch(() => ({}));
  }

  /** Probe a new container: true when healthy, else a reason string. */
  async function probe(name) {
    try {
      const health = await fetchImpl(`http://${name}:${APP_PORT}/health`, { signal: AbortSignal.timeout(5000) });
      if (!health.ok) return `/health returned ${health.status}`;
      const pull = await fetchImpl(`http://${name}:${APP_PORT}/api/pull/status`, { signal: AbortSignal.timeout(5000) });
      const body = pull.ok ? await pull.json() : null;
      if (!body || body.mode === "unknown") return "PLC bridge is not reachable";
      const st = await getAppState(name);
      if (st?.phase !== "active") return `container phase is ${st?.phase ?? "unknown"}`;
      return true;
    } catch (err) {
      return err.message;
    }
  }

  async function waitFor(check, timeoutMs) {
    const deadline = now() + timeoutMs;
    for (;;) {
      const result = await check();
      if (result) return result;
      if (now() >= deadline) return null;
      await sleep(config.pollMs);
    }
  }

  // ---- update flow ----------------------------------------------------------
  const retryAt = () => {
    const t = now() + config.retryMs;
    return open(t) ? t : nextOpenAt(t);
  };

  /** Undo everything before commit: the old container keeps (or resumes) service. */
  async function abortBeforeCommit(u, old, { standby, resumeOld, phase, reason, notBefore }) {
    if (resumeOld) {
      await postHandover(old.name, "/handover/resume").catch((err) => log(`resume ${old.name}: ${err.message}`));
    }
    await removeApp(standby);
    await setRestart(old.name, "unless-stopped").catch((err) => log(`restart policy ${old.name}: ${err.message}`));
    await ensureRunning(old.name).catch((err) => log(`start ${old.name}: ${err.message}`));
    if (phase === "canceled" || phase === "failed") return finish(u, phase, reason);
    u.standbyName = null;
    u.handoverToken = null;
    u.notBefore = iso(notBefore);
    return setPhase(u, phase, reason);
  }

  /** Window/cancel gate before commit; false when the run must stop here. */
  async function gate(u, old, standby, resumeOld) {
    if (u.cancelRequested) {
      await abortBeforeCommit(u, old, { standby, resumeOld, phase: "canceled", reason: "Canceled by an admin" });
      return false;
    }
    if (!open()) {
      await abortBeforeCommit(u, old, {
        standby,
        resumeOld,
        phase: "queued",
        reason: "The update window closed; waiting for the next window",
        notBefore: nextOpenAt(),
      });
      return false;
    }
    return true;
  }

  async function rollback(u, standby, old, reason) {
    if (standby) u.logs = tail(await docker.containerLogs(standby, 200).catch(() => ""));
    await removeApp(standby);
    const { note, serving } = await rollbackDatabase(old.name, old.image, u.id);
    let revived = false;
    try {
      await setRestart(old.name, "unless-stopped");
      // Restart (not just start): a "released" supervisor must boot fresh.
      if (!serving) await docker.containerRestart(old.name);
      revived = true;
    } catch (err) {
      log(`restart ${old.name} failed (${err.message}); recreating from ${old.image}`);
    }
    if (!revived) await bootstrap(old.image, old.version);
    await save();
    await writeRoute();
    return finish(u, "rolled-back", `${reason}. Rolled back to ${old.version}${note}.`);
  }

  async function promote(u, standby, old) {
    const superseded = state.previous;
    state.previous = { image: old.image, version: old.version, digest: old.digest ?? null };
    state.active = { name: standby, image: u.target.image, digest: u.target.digest, version: u.target.version };
    // Persist first: a crash after this point reconciles to the NEW version.
    await finish(u, "done", null);
    await writeRoute();
    await setRestart(standby, "unless-stopped");
    await removeApp(old.name);
    if (superseded?.image && ![state.active.image, state.previous.image].includes(superseded.image)) {
      await docker.imageRemove(superseded.image).catch(() => {});
    }
  }

  /** runUpdate plus a safety net: an unexpected error never strands the app. */
  async function runUpdateSafely(u) {
    const old = state.active;
    try {
      await runUpdate(u, old);
    } catch (err) {
      log(`update ${u.id} crashed in ${u.phase}: ${err.stack || err.message}`);
      const reason = `Unexpected orchestrator error: ${err.message}`;
      if (!old) return finish(u, "failed", reason);
      if (["committed", "starting", "verifying"].includes(u.phase)) {
        return rollback(u, u.standbyName, old, reason);
      }
      return abortBeforeCommit(u, old, {
        standby: u.standbyName,
        resumeOld: u.phase === "draining",
        phase: "failed",
        reason,
      });
    }
  }

  async function runUpdate(u, old) {
    u.attempts = (u.attempts || 0) + 1;
    u.cancelRequested = false;
    await setPhase(u, "preparing", null);
    if (!old) return finish(u, "failed", "No active container to update");

    // Gate 1.
    if (!(await gate(u, old, null, false))) return;
    try {
      if (prepping) await prepping.catch(() => {});
      await ensureImage(u.target);
    } catch (err) {
      return finish(u, "failed", `Image verification failed: ${err.message}`);
    }

    // Standby: the new container preflights while the old one keeps serving.
    const standby = appContainerName(u.target.version, random(3));
    u.handoverToken = random(32);
    u.standbyName = standby;
    await setPhase(u, "standby");
    try {
      await createApp(standby, {
        image: u.target.image,
        version: u.target.version,
        standby: { predecessor: old.name, handoverToken: u.handoverToken },
      });
    } catch (err) {
      await removeApp(standby);
      return finish(u, "failed", `Could not create the new container: ${err.message}`);
    }
    const pre = await waitFor(async () => {
      const st = await getAppState(standby);
      if (st?.phase === "standby-ready") return { ok: true };
      if (st?.phase === "preflight-failed") return { ok: false, reason: st.error || "preflight failed" };
      const info = await docker.containerInspect(standby);
      if (info && !info.State?.Running) return { ok: false, reason: `container exited (${info.State?.ExitCode})` };
      return null;
    }, config.preflightTimeoutMs);
    if (!pre?.ok) {
      u.logs = tail(await docker.containerLogs(standby, 200).catch(() => ""));
      await removeApp(standby);
      return finish(u, "failed", `New version failed preflight: ${pre?.reason ?? "timed out"}`);
    }

    // Gate 2, then release: the old container drains.
    if (!(await gate(u, old, standby, false))) return;
    try {
      await setRestart(old.name, "no");
      await postHandover(old.name, "/handover/release", {
        protocol: PROTOCOL,
        updateId: u.id,
        updateToken: u.handoverToken,
        successor: standby,
        drainTimeoutMs: config.drainTimeoutMs,
      });
    } catch (err) {
      return abortBeforeCommit(u, old, {
        standby,
        resumeOld: false,
        phase: "postponed",
        reason: `The running version did not accept the release: ${err.message}`,
        notBefore: retryAt(),
      });
    }
    await setPhase(u, "draining");

    // Gate 3: the window is checked on every poll during the drain.
    const deadline = now() + config.drainTimeoutMs + 60_000;
    let lastSeen = now();
    for (;;) {
      if (!(await gate(u, old, standby, true))) return;
      const st = await getAppState(old.name);
      if (st) lastSeen = now();
      if (st?.phase === "drained") break;
      if (st?.phase === "active") {
        const timedOut = st.lastRelease?.result === "drain-timeout";
        const minutes = Math.round(config.drainTimeoutMs / 60_000);
        return abortBeforeCommit(u, old, {
          standby,
          resumeOld: false,
          phase: "postponed",
          reason: timedOut
            ? `${st.activeMonitors ?? "Some"} checkout(s) still in progress after ${minutes} min; postponed`
            : `The running version resumed service (${st.lastRelease?.result ?? "unknown"}); postponed`,
          notBefore: retryAt(),
        });
      }
      if (now() - lastSeen > config.lostContactMs || now() > deadline) {
        return abortBeforeCommit(u, old, {
          standby,
          resumeOld: true,
          phase: "postponed",
          reason: "Lost contact with the running version during the drain; postponed",
          notBefore: retryAt(),
        });
      }
      await sleep(config.pollMs);
    }

    // Gate 4, then commit: the point of no return.
    if (!(await gate(u, old, standby, true))) return;
    await setPhase(u, "committed");
    try {
      await postHandover(old.name, "/handover/commit");
    } catch (err) {
      const st = await getAppState(old.name);
      if (st?.phase === "drained" || st?.phase === "active") {
        return abortBeforeCommit(u, old, {
          standby,
          resumeOld: true,
          phase: "postponed",
          reason: `Commit was not accepted: ${err.message}`,
          notBefore: retryAt(),
        });
      }
      log(`commit response lost (${err.message}); continuing — the old container is ${st?.phase ?? "unreachable"}`);
    }

    // The old container stops, snapshots the DB and acks the new one.
    await setPhase(u, "starting");
    const started = await waitFor(async () => {
      const n = await getAppState(standby);
      if (n?.phase === "active") return { ok: true };
      if (n?.phase === "start-failed") return { ok: false, reason: `New version failed to start: ${n.error || "unknown error"}` };
      const o = await getAppState(old.name);
      const result = o?.lastRelease?.result;
      if (o?.phase === "active" && (result === "ack-failed" || result === "snapshot-failed")) {
        return { ok: false, oldResumed: true, result };
      }
      const info = await docker.containerInspect(standby);
      if (!info || !info.State?.Running) return { ok: false, reason: "The new container stopped" };
      return null;
    }, config.handoverTimeoutMs);

    if (started?.oldResumed) {
      // The old container never released the DB and is serving again.
      await removeApp(standby);
      await setRestart(old.name, "unless-stopped").catch((err) => log(err.message));
      if (started.result === "snapshot-failed") {
        return finish(u, "failed", "The running version could not snapshot the database; update aborted");
      }
      u.standbyName = null;
      u.handoverToken = null;
      u.notBefore = iso(retryAt());
      return setPhase(u, "postponed", "The new version never confirmed the handover; postponed");
    }
    if (!started?.ok) return rollback(u, standby, old, started?.reason ?? "The new version did not start in time");

    // Verify, then promote or roll back.
    await setPhase(u, "verifying");
    const deadlineVerify = now() + config.verifyTimeoutMs;
    let healthySince = null;
    let reason = "never became healthy";
    for (;;) {
      const result = await probe(standby);
      if (result === true) {
        healthySince ??= now();
        if (now() - healthySince >= config.verifyHoldMs) return promote(u, standby, old);
      } else {
        healthySince = null;
        reason = result;
      }
      if (now() >= deadlineVerify) return rollback(u, standby, old, `Health check failed: ${reason}`);
      await sleep(config.pollMs);
    }
  }

  // ---- public API -----------------------------------------------------------
  async function applyAction(action) {
    switch (action.type) {
      case "remove":
        return removeApp(action.name);
      case "resume":
        return postHandover(action.name, "/handover/resume").catch((err) => log(`resume: ${err.message}`));
      case "rollbackDb": {
        const { note, serving } = await rollbackDatabase(action.name, action.image, action.updateId);
        if (note && state.update) state.update.lastReason += note;
        // A "released" (or stopped) old supervisor must boot fresh.
        if (action.name && !serving) await docker.containerRestart(action.name);
        return;
      }
      case "setRestart":
        return setRestart(action.name, action.policy);
      case "ensureRunning":
        return ensureRunning(action.name);
      case "bootstrap":
        return bootstrap(action.image, action.version);
      default:
        throw new Error(`Unknown reconcile action ${action.type}`);
    }
  }

  return {
    /** Load state, reconcile with Docker, and make sure one app is active. */
    async init() {
      state = await store.load();
      if (!state.secret) state.secret = newSecret();
      const list = await docker.containerList({ labels: ["sparky.role=app"] });
      const containers = list.map((c) => ({
        name: String(c.Names?.[0] || "").replace(/^\//, ""),
        running: c.State === "running",
        image: c.Image,
        created: c.Created,
      }));
      const result = reconcile({ state, containers, initialImage: config.initialImage, now: now() });
      state = result.state;
      for (const action of result.actions) {
        log(`reconcile: ${action.type} ${action.name || action.image || action.updateId || ""}`.trim());
        await applyAction(action);
      }
      await writeRoute();
      await save();
    },

    /** Control-API auth: only the active app container's token is accepted. */
    authorize(header) {
      return authorize(header, { secret: state?.secret, active: state?.active?.name });
    },

    status: () => statusView(),

    async check() {
      let latest = null;
      let latestError = null;
      try {
        latest = await releaseSource.latest();
      } catch (err) {
        latestError = err.message;
      }
      const current = state.active ? { version: state.active.version, digest: state.active.digest } : null;
      return {
        current,
        latest: latest ? { version: latest.version, digest: latest.digest } : null,
        latestError,
        available: !!latest && !!current && isNewer(latest.version, current.version),
        window: describeWindow(new Date(now()), win, config.tz),
        update: statusView(),
      };
    },

    /** Queue the latest release. It runs as soon as the window is open. */
    async queueUpdate() {
      if (running) throw httpError(409, "An update is already in progress");
      let target;
      try {
        target = await releaseSource.latest();
      } catch (err) {
        throw httpError(502, `Could not read the latest release: ${err.message}`);
      }
      if (state.active && !isNewer(target.version, state.active.version)) {
        throw httpError(409, `Already up to date (${state.active.version})`);
      }
      const t = now();
      const stamp = iso(t).replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
      const u = {
        id: `u-${stamp}-${random(3)}`,
        phase: "queued",
        target,
        from: state.active?.version ?? null,
        queuedAt: iso(t),
        notBefore: iso(open(t) ? t : nextOpenAt(t)),
        attempts: 0,
        lastReason: open(t) ? null : "Waiting for the update window",
        standbyName: null,
        handoverToken: null,
        cancelRequested: false,
      };
      state.update = u;
      await save();
      log(`update ${u.id} queued: ${u.from} -> ${target.version}, not before ${u.notBefore}`);
      // Download and verify now (no service impact) so problems surface early.
      prepping = ensureImage(target)
        .catch(async (err) => {
          if (state.update === u && WAITING.includes(u.phase) && !running) {
            await finish(u, "failed", `Image verification failed: ${err.message}`);
          }
          throw err;
        })
        .finally(() => {
          prepping = null;
        });
      prepping.catch(() => {});
      return { updateId: u.id, state: "queued", notBefore: u.notBefore };
    },

    async cancelUpdate() {
      const u = state.update;
      if (!u || TERMINAL.includes(u.phase)) throw httpError(409, "There is no update to cancel");
      if (WAITING.includes(u.phase) && !running) {
        await finish(u, "canceled", "Canceled by an admin");
        return { state: "canceled" };
      }
      if (WAITING.includes(u.phase) || PRE_COMMIT.includes(u.phase)) {
        u.cancelRequested = true;
        await save();
        return { state: "canceling" };
      }
      throw httpError(409, "The handover is already committed and cannot be canceled");
    },

    /** Scheduler tick: start a due update when the window is open. */
    async tick() {
      if (running) return running;
      const u = state.update;
      if (!u || !WAITING.includes(u.phase)) return;
      const t = now();
      if (t < Date.parse(u.notBefore)) return;
      if (!open(t)) {
        u.notBefore = iso(nextOpenAt(t));
        await save();
        return;
      }
      running = runUpdateSafely(u)
        .catch((err) => log(`update ${u.id}: recovery failed: ${err.stack || err.message}`))
        .finally(() => {
          running = null;
        });
      return running;
    },

    /** For tests and diagnostics. */
    get state() {
      return state;
    },
  };
}
