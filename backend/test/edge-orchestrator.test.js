// Orchestrator state machine against a simulated Docker engine, simulated app
// containers speaking handover protocol v1, and a fake clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrchestrator } from "../../deploy/edge/orchestrator.mjs";
import { tokenFor } from "../../deploy/edge/auth.mjs";

const REPO = "ghcr.io/jdmasuta/sparky-app";
const digest = (c) => "sha256:" + c.repeat(64);
const OLD_IMG = `${REPO}@${digest("1")}`;
const NEW_IMG = `${REPO}@${digest("2")}`;
const TARGET = { version: "3.7.0", image: NEW_IMG, repo: REPO, digest: digest("2") };
const at = (s) => Date.parse(s);

const imageInfo = (ref, version, repoDigest = ref) => ({
  RepoDigests: [repoDigest],
  Config: { Labels: { "org.opencontainers.image.version": version } },
});

class Sim {
  constructor({ start = "2026-10-15T18:00:00Z", profiles = {}, registry = {} } = {}) {
    this.t = at(start);
    this.profiles = { [OLD_IMG]: {}, [NEW_IMG]: {}, ...profiles };
    this.images = new Map([[OLD_IMG, imageInfo(OLD_IMG, "3.6.0")]]);
    this.registry = new Map([[NEW_IMG, imageInfo(NEW_IMG, "3.7.0")], ...Object.entries(registry)]);
    this.containers = new Map();
    this.calls = [];
    this.restores = [];
    this.restoreCode = 0;
    this.failInspect = null; // (id) => boolean: make containerInspect throw
    this.latest = TARGET;
    this.counter = 0;
    this.saved = { state: null, route: null, status: null };
    this.docker = this.#docker();
  }

  // ---- deps -----------------------------------------------------------------
  deps(config = {}) {
    return {
      docker: this.docker,
      store: {
        load: async () => structuredClone(this.saved.state ?? {}),
        save: async (s) => void (this.saved.state = structuredClone(s)),
        writeRoute: async (r) => void (this.saved.route = r),
        writeStatus: async (s) => void (this.saved.status = s),
      },
      releaseSource: { latest: async () => this.latest },
      config: { tz: "UTC", controlSubnet: "172.30.1.0/24", initialImage: OLD_IMG, ...config },
      fetchImpl: (url, opts) => this.#fetch(url, opts),
      now: () => this.t,
      // Advance the fake clock and yield a macrotask so tests can act mid-run.
      sleep: async (ms) => {
        this.t += ms;
        await new Promise((r) => setImmediate(r));
      },
      random: (bytes) => (++this.counter).toString(16).padStart(bytes * 2, "0"),
      log: () => {},
    };
  }

  app(name) {
    return this.containers.get(name);
  }
  apps() {
    return [...this.containers.values()].filter((c) => !c.helper);
  }
  op(kind, name) {
    return this.calls.findIndex((c) => c[0] === kind && c[1] === name);
  }

  // ---- simulated app containers ----------------------------------------------
  #boot(c) {
    c.running = true;
    c.lastRelease = null;
    const p = this.profiles[c.image] || {};
    // Like the real supervisor: a standby-created container boots in standby
    // until it has been promoted (marker written when it accepts the ack).
    if (c.env.SPARKY_STANDBY === "1" && !c.promoted) {
      if (p.preflight === "exit") {
        c.running = false;
        c.exitCode = 1;
      } else c.phase = p.preflight === "fail" ? "preflight-failed" : "standby-ready";
    } else {
      c.phase = "active";
      c.booting = p.bootPolls ?? 0; // supervisor still starting services
    }
  }

  #state(c) {
    const p = this.profiles[c.image] || {};
    if (c.booting > 0) {
      c.booting--;
      return { protocol: 1, phase: "starting", lastRelease: null, activeMonitors: 0 };
    }
    if (c.phase === "draining") {
      if (c.drainPolls-- <= 0) {
        if (p.drain === "timeout") {
          c.phase = "active";
          c.lastRelease = { result: "drain-timeout" };
          c.activeMonitors = 2;
        } else {
          c.phase = "drained";
          p.onDrained?.(this);
        }
      }
    } else if (c.phase === "starting" && c.startPolls-- <= 0) {
      c.phase = p.start === "fail" ? "start-failed" : "active";
      if (c.phase === "start-failed") c.error = "backend exited during startup";
    }
    return { protocol: 1, phase: c.phase, lastRelease: c.lastRelease, activeMonitors: c.activeMonitors ?? 0, error: c.error };
  }

  #commit(c) {
    const p = this.profiles[c.image] || {};
    if (p.snapshotFails) {
      c.phase = "active";
      c.lastRelease = { result: "snapshot-failed" };
      return;
    }
    const n = this.containers.get(c.release.successor);
    const np = n ? this.profiles[n.image] || {} : {};
    const tokenOk = n && n.env.SPARKY_HANDOVER_TOKEN === c.release.updateToken && n.env.SPARKY_PREDECESSOR === c.name;
    if (n?.running && n.phase === "standby-ready" && tokenOk && !np.ackFails) {
      c.phase = "released";
      c.lastRelease = { result: "handed-over" };
      n.phase = "starting";
      n.promoted = true;
      n.startPolls = np.startPolls ?? 0;
    } else {
      c.phase = "active";
      c.lastRelease = { result: "ack-failed" };
    }
  }

  async #fetch(url, opts = {}) {
    const u = new URL(url);
    const c = this.containers.get(u.hostname);
    if (!c?.running) throw new TypeError("fetch failed: ECONNREFUSED");
    const p = this.profiles[c.image] || {};
    const json = (status, body) => new Response(JSON.stringify(body), { status });
    if (u.port === "3000") {
      const healthy = c.phase === "active" && p.healthy !== false;
      if (u.pathname === "/health") return json(healthy ? 200 : 503, {});
      if (u.pathname === "/api/pull/status") return json(200, { connected: true, mode: "sim" });
      return json(404, {});
    }
    if (u.pathname === "/handover/state") return json(200, this.#state(c));
    const auth = opts.headers?.authorization;
    if (auth !== `Bearer ${tokenFor(this.secret(), c.name)}`) return json(401, { error: "Unauthorized" });
    this.calls.push(["POST", c.name, u.pathname]);
    if (u.pathname === "/handover/release") {
      if (c.phase !== "active" || c.booting > 0) return json(409, {});
      c.release = JSON.parse(opts.body);
      c.phase = "draining";
      c.drainPolls = p.drainPolls ?? 1;
      return json(202, {});
    }
    if (u.pathname === "/handover/resume") {
      if (!["draining", "drained"].includes(c.phase)) return json(409, {});
      c.phase = "active";
      c.lastRelease = { result: "resumed" };
      return json(200, {});
    }
    if (u.pathname === "/handover/commit") {
      if (c.phase !== "drained") return json(409, {});
      this.#commit(c);
      return json(202, {});
    }
    return json(404, {});
  }

  // ---- simulated Docker engine ---------------------------------------------
  #docker() {
    const get = (id) => {
      const c = this.containers.get(id);
      if (!c) throw Object.assign(new Error(`No such container ${id}`), { status: 404 });
      return c;
    };
    return {
      version: async () => ({ ApiVersion: "1.45" }),
      imageInspect: async (ref) => this.images.get(ref) ?? null,
      imagePull: async (ref) => {
        this.calls.push(["pull", ref]);
        if (!this.registry.has(ref)) throw new Error(`manifest unknown: ${ref}`);
        this.images.set(ref, this.registry.get(ref));
      },
      imageRemove: async (ref) => this.images.delete(ref),
      containerCreate: async (name, body) => {
        if (this.containers.has(name)) throw Object.assign(new Error("name in use"), { status: 409 });
        const env = Object.fromEntries((body.Env || []).map((e) => [e.split("=")[0], e.slice(e.indexOf("=") + 1)]));
        this.containers.set(name, {
          name,
          image: body.Image,
          env,
          body,
          running: false,
          restart: body.HostConfig?.RestartPolicy?.Name,
          helper: body.Labels?.["sparky.role"] === "helper",
          networks: [body.HostConfig?.NetworkMode],
          created: this.t,
        });
        this.calls.push(["create", name]);
        return name;
      },
      networkConnect: async (net, id, { aliases } = {}) => {
        get(id).networks.push(net);
        if (aliases) get(id).aliases = { ...get(id).aliases, [net]: aliases };
      },
      containerStart: async (id) => {
        const c = get(id);
        this.calls.push(["start", id]);
        if (c.helper) {
          this.restores.push({ image: c.image, cmd: c.body.Cmd });
          c.exitCode = this.restoreCode;
          return;
        }
        this.#boot(c);
      },
      containerStop: async (id) => {
        const c = this.containers.get(id);
        this.calls.push(["stop", id]);
        if (c) {
          c.running = false;
          c.phase = "stopped";
        }
      },
      containerRestart: async (id) => {
        const c = get(id);
        this.calls.push(["restart", id]);
        this.#boot(c);
      },
      containerUpdate: async (id, update) => {
        get(id).restart = update.RestartPolicy.Name;
        this.calls.push(["restartPolicy", id, update.RestartPolicy.Name]);
      },
      containerRemove: async (id) => {
        this.calls.push(["remove", id]);
        return this.containers.delete(id);
      },
      containerInspect: async (id) => {
        if (this.failInspect?.(id)) throw new Error("docker daemon hiccup");
        const c = this.containers.get(id);
        return c ? { State: { Running: c.running, ExitCode: c.exitCode ?? 0 } } : null;
      },
      containerList: async () =>
        this.apps().map((c) => ({ Names: [`/${c.name}`], State: c.running ? "running" : "exited", Image: c.image, Created: c.created })),
      containerLogs: async () => "simulated log line",
      containerWait: async (id) => get(id).exitCode ?? 0,
    };
  }
}

async function setup(simOpts = {}, config = {}) {
  const sim = new Sim(simOpts);
  const orch = createOrchestrator(sim.deps(config));
  sim.secret = () => orch.state.secret;
  await orch.init();
  return { sim, orch, oldName: orch.state.active.name };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

async function runQueued(orch) {
  const queued = await orch.queueUpdate();
  await settle(); // background pull/verify
  await orch.tick();
  return queued;
}

// ---- bootstrap ------------------------------------------------------------

test("init bootstraps one active app from the initial image", async () => {
  const { sim, orch, oldName } = await setup();
  assert.match(oldName, /^sparky-app-3\.6\.0-[0-9a-f]{6}$/);
  assert.deepEqual(orch.state.active, { name: oldName, image: OLD_IMG, digest: digest("1"), version: "3.6.0" });
  const c = sim.app(oldName);
  assert.equal(c.running, true);
  assert.equal(c.restart, "unless-stopped");
  assert.deepEqual(c.networks, ["sparky-front", "sparky-control", "sparky-app-egress"]);
  assert.deepEqual(c.aliases, { "sparky-control": [`${oldName}-control`] }, "handover alias only on the control network");
  assert.equal(c.env.SPARKY_ORCH_TOKEN, tokenFor(orch.state.secret, oldName));
  assert.deepEqual(sim.saved.route, { name: oldName, port: 3000, updatedAt: sim.saved.route.updatedAt });
  assert.equal(sim.saved.status.phase, "idle");
  assert.match(orch.state.secret, /^[0-9a-f]{64}$/);
});

test("init on an existing install keeps the active container and secret", async () => {
  const { sim, orch, oldName } = await setup();
  const secret = orch.state.secret;
  const again = createOrchestrator(sim.deps());
  await again.init();
  assert.equal(again.state.active.name, oldName);
  assert.equal(again.state.secret, secret);
  assert.equal(sim.apps().length, 1);
});

// ---- happy path -------------------------------------------------------------

test("update inside the window: standby, drain, commit, verify, promote", async () => {
  const { sim, orch, oldName } = await setup();
  const queued = await runQueued(orch);
  assert.equal(queued.state, "queued");
  assert.equal(queued.notBefore, "2026-10-15T18:00:00.000Z");

  const u = orch.state.update;
  assert.equal(u.phase, "done", u.lastReason);
  const newName = orch.state.active.name;
  assert.match(newName, /^sparky-app-3\.7\.0-/);
  assert.deepEqual(orch.state.active, { name: newName, image: NEW_IMG, digest: digest("2"), version: "3.7.0" });
  assert.deepEqual(orch.state.previous, { image: OLD_IMG, version: "3.6.0", digest: digest("1") });
  assert.equal(sim.saved.route.name, newName);
  assert.equal(sim.saved.status.phase, "done");
  assert.equal(sim.app(oldName), undefined, "old container removed");
  assert.equal(sim.app(newName).restart, "unless-stopped", "promoted container restarts with Docker");
  assert.equal(sim.app(newName).env.SPARKY_STANDBY, "1");
  assert.equal(sim.app(newName).env.SPARKY_PREDECESSOR, oldName);

  // Ordering: old container stops auto-restarting before it is asked to release,
  // and only commits after the drain.
  const noRestart = sim.calls.findIndex((c) => c[0] === "restartPolicy" && c[1] === oldName && c[2] === "no");
  const release = sim.calls.findIndex((c) => c[2] === "/handover/release");
  const commit = sim.calls.findIndex((c) => c[2] === "/handover/commit");
  assert.ok(noRestart !== -1 && noRestart < release && release < commit);
  assert.equal(sim.restores.length, 0);
  assert.equal(orch.state.history.at(-1).result, "done");
  assert.equal(u.handoverToken, null, "per-update secret is cleared");
});

test("after promotion only the new container's token is accepted", async () => {
  const { orch, oldName } = await setup();
  await runQueued(orch);
  const newName = orch.state.active.name;
  assert.equal(orch.authorize(`Bearer ${tokenFor(orch.state.secret, newName)}`), true);
  assert.equal(orch.authorize(`Bearer ${tokenFor(orch.state.secret, oldName)}`), false);
});

// ---- update window ---------------------------------------------------------

test("triggered outside the window: queued until 17:00, then runs", async () => {
  const { sim, orch } = await setup({ start: "2026-10-15T12:00:00Z" });
  const queued = await orch.queueUpdate();
  assert.equal(queued.notBefore, "2026-10-15T17:00:00.000Z");
  assert.equal(orch.state.update.lastReason, "Waiting for the update window");
  await settle();
  await orch.tick();
  assert.equal(orch.state.update.phase, "queued");
  assert.equal(sim.apps().length, 1, "nothing created before the window opens");
  sim.t = at("2026-10-15T17:00:00Z");
  await orch.tick();
  assert.equal(orch.state.update.phase, "done");
});

test("window closes mid-drain: resume the old version and wait for the next window", async () => {
  const { sim, orch, oldName } = await setup({
    start: "2026-10-15T02:55:00Z",
    profiles: { [OLD_IMG]: { drainPolls: 10_000 } },
  });
  await runQueued(orch);
  const u = orch.state.update;
  assert.equal(u.phase, "queued");
  assert.equal(u.notBefore, "2026-10-15T17:00:00.000Z");
  assert.match(u.lastReason, /window closed/);
  assert.ok(sim.calls.some((c) => c[1] === oldName && c[2] === "/handover/resume"));
  assert.ok(!sim.calls.some((c) => c[2] === "/handover/commit"));
  assert.equal(sim.app(oldName).phase, "active");
  assert.equal(sim.app(oldName).restart, "unless-stopped");
  assert.equal(sim.apps().length, 1, "standby container removed");
  assert.ok(sim.t >= at("2026-10-15T03:00:00Z") && sim.t < at("2026-10-15T03:01:00Z"));
});

test("drained just after the window closed: gate 4 resumes instead of committing", async () => {
  const { sim, orch, oldName } = await setup({
    start: "2026-10-15T02:59:00Z",
    profiles: { [OLD_IMG]: { drainPolls: 1, onDrained: (s) => (s.t = at("2026-10-15T03:00:30Z")) } },
  });
  await runQueued(orch);
  assert.equal(orch.state.update.phase, "queued");
  assert.ok(sim.calls.some((c) => c[2] === "/handover/resume"));
  assert.ok(!sim.calls.some((c) => c[2] === "/handover/commit"));
  assert.equal(orch.state.active.name, oldName);
});

test("a committed handover finishes even when it runs past 03:00", async () => {
  const { sim, orch } = await setup({
    start: "2026-10-15T02:59:00Z",
    profiles: { [NEW_IMG]: { startPolls: 60 } }, // ~2 minutes to start
  });
  await runQueued(orch);
  assert.equal(orch.state.update.phase, "done");
  assert.ok(sim.t > at("2026-10-15T03:00:00Z"), "finished after the window closed");
});

test("a postponed retry that lands after the window closes waits for the next window", async () => {
  const { sim, orch } = await setup({ start: "2026-10-15T02:50:00Z", profiles: { [OLD_IMG]: { drain: "timeout", drainPolls: 3 } } });
  await runQueued(orch);
  assert.equal(orch.state.update.phase, "postponed");
  assert.equal(orch.state.update.notBefore, "2026-10-15T17:00:00.000Z", "02:50 + 15 min retry is after 03:00");
  sim.t = at("2026-10-15T10:00:00Z");
  await orch.tick();
  assert.equal(orch.state.update.phase, "postponed");
});

// ---- drain ----------------------------------------------------------------------

test("drain timeout: postpone 15 min, old version keeps serving", async () => {
  const { sim, orch, oldName } = await setup({ profiles: { [OLD_IMG]: { drain: "timeout", drainPolls: 3 } } });
  await runQueued(orch);
  const u = orch.state.update;
  assert.equal(u.phase, "postponed");
  assert.match(u.lastReason, /2 checkout\(s\) still in progress after 10 min/);
  assert.equal(Date.parse(u.notBefore) - sim.t, 900_000);
  assert.equal(sim.app(oldName).phase, "active");
  assert.equal(sim.app(oldName).restart, "unless-stopped");
  assert.equal(sim.apps().length, 1);
  // The retry runs once due.
  sim.profiles[OLD_IMG] = {};
  sim.t = Date.parse(u.notBefore);
  await orch.tick();
  assert.equal(orch.state.update.phase, "done");
  assert.equal(orch.state.update.attempts, 2);
});

test("old version still booting: wait until it serves, then hand over", async () => {
  const { orch } = await setup({ profiles: { [OLD_IMG]: { bootPolls: 5 } } });
  await runQueued(orch);
  assert.equal(orch.state.update.phase, "done", orch.state.update.lastReason);
});

test("old version never becomes ready: postpone without releasing", async () => {
  const { sim, orch, oldName } = await setup({ profiles: { [OLD_IMG]: { bootPolls: 1_000_000 } } });
  await runQueued(orch);
  assert.equal(orch.state.update.phase, "postponed");
  assert.match(orch.state.update.lastReason, /not ready to hand over/);
  assert.ok(!sim.calls.some((c) => c[2] === "/handover/release"));
  assert.equal(sim.apps().length, 1);
  assert.equal(sim.app(oldName).restart, "unless-stopped");
});

test("short drain timeouts are reported in seconds", async () => {
  const { orch } = await setup({ profiles: { [OLD_IMG]: { drain: "timeout", drainPolls: 1 } } }, { drainTimeoutMs: 5000 });
  await runQueued(orch);
  assert.match(orch.state.update.lastReason, /still in progress after 5 s; postponed/);
});

// ---- failures before commit ---------------------------------------------------

test("preflight failure: new container removed, old one never touched", async () => {
  const { sim, orch, oldName } = await setup({ profiles: { [NEW_IMG]: { preflight: "fail" } } });
  await runQueued(orch);
  assert.equal(orch.state.update.phase, "failed");
  assert.match(orch.state.update.lastReason, /failed preflight/);
  assert.equal(sim.apps().length, 1);
  assert.equal(sim.op("restartPolicy", oldName), -1, "old restart policy untouched");
  assert.ok(!sim.calls.some((c) => c[2] === "/handover/release"));
  assert.equal(orch.state.active.name, oldName);
});

test("standby container exits during preflight", async () => {
  const { sim, orch } = await setup({ profiles: { [NEW_IMG]: { preflight: "exit" } } });
  await runQueued(orch);
  assert.equal(orch.state.update.phase, "failed");
  assert.match(orch.state.update.lastReason, /container exited/);
  assert.equal(sim.apps().length, 1);
});

test("image digest mismatch fails the update before anything starts", async () => {
  const { sim, orch } = await setup({ registry: { [NEW_IMG]: imageInfo(NEW_IMG, "3.7.0", `${REPO}@${digest("9")}`) } });
  await orch.queueUpdate();
  await settle();
  assert.equal(orch.state.update.phase, "failed");
  assert.match(orch.state.update.lastReason, /digest does not match/);
  await orch.tick();
  assert.equal(sim.apps().length, 1);
});

test("image version label mismatch fails the update", async () => {
  const { orch } = await setup({ registry: { [NEW_IMG]: imageInfo(NEW_IMG, "9.9.9") } });
  await orch.queueUpdate();
  await settle();
  assert.equal(orch.state.update.phase, "failed");
  assert.match(orch.state.update.lastReason, /version label/);
});

test("successor never acks: old version resumes, update postponed, DB untouched", async () => {
  const { sim, orch, oldName } = await setup({ profiles: { [NEW_IMG]: { ackFails: true } } });
  await runQueued(orch);
  assert.equal(orch.state.update.phase, "postponed");
  assert.equal(orch.state.active.name, oldName);
  assert.equal(sim.app(oldName).restart, "unless-stopped");
  assert.equal(sim.restores.length, 0);
  assert.equal(sim.apps().length, 1);
});

test("old version cannot snapshot the DB: update fails, old keeps serving", async () => {
  const { sim, orch, oldName } = await setup({ profiles: { [OLD_IMG]: { snapshotFails: true } } });
  await runQueued(orch);
  assert.equal(orch.state.update.phase, "failed");
  assert.match(orch.state.update.lastReason, /snapshot/);
  assert.equal(sim.app(oldName).phase, "active");
  assert.equal(sim.restores.length, 0);
});

// ---- failures after commit: rollback ---------------------------------------------

for (const [label, profile, reason] of [
  ["fails its health check", { healthy: false }, /Health check failed/],
  ["fails to start", { start: "fail" }, /failed to start/],
]) {
  test(`new version ${label}: roll back DB snapshot and old version`, async () => {
    const { sim, orch, oldName } = await setup({ profiles: { [NEW_IMG]: profile } });
    await runQueued(orch);
    const u = orch.state.update;
    assert.equal(u.phase, "rolled-back");
    assert.match(u.lastReason, reason);
    assert.match(u.lastReason, /Rolled back to 3\.6\.0\./);
    assert.equal(orch.state.active.name, oldName);
    assert.equal(sim.saved.route.name, oldName);
    assert.equal(sim.apps().length, 1);
    assert.equal(sim.app(oldName).phase, "active", "old version restarted");
    assert.equal(sim.app(oldName).restart, "unless-stopped");
    assert.deepEqual(sim.restores, [
      {
        image: OLD_IMG,
        cmd: ["node", "deploy/container/restore-snapshot.mjs", "--snapshot", `/data/backups/pre-${u.id}.sqlite`, "--db", "/data/prod.sqlite"],
      },
    ]);
    // The old container is stopped before the restore runs.
    const stop = sim.op("stop", oldName);
    const helperStart = sim.calls.findIndex((c) => c[0] === "start" && c[1].startsWith("sparky-restore-"));
    assert.ok(stop !== -1 && stop < helperStart);
    assert.equal(u.logs, "simulated log line");
  });
}

test("rollback to a version that was itself promoted from standby brings it back active", async () => {
  // 3.6.0 -> 3.7.0 succeeds (3.7.0 was created as a standby container), then a
  // broken 3.8.0 rolls back: the restarted 3.7.0 must serve, not wait in standby.
  const BAD_IMG = `${REPO}@${digest("3")}`;
  const { sim, orch } = await setup({
    profiles: { [BAD_IMG]: { healthy: false } },
    registry: { [BAD_IMG]: imageInfo(BAD_IMG, "3.8.0") },
  });
  await runQueued(orch);
  const promotedName = orch.state.active.name;
  assert.equal(sim.app(promotedName).env.SPARKY_STANDBY, "1");
  sim.latest = { version: "3.8.0", image: BAD_IMG, repo: REPO, digest: digest("3") };
  await runQueued(orch);
  assert.equal(orch.state.update.phase, "rolled-back");
  assert.equal(orch.state.active.name, promotedName);
  assert.equal(sim.app(promotedName).phase, "active", "restarted promoted container must serve");
});

test("a promoted container comes back active after a Docker restart", async () => {
  const { sim, orch } = await setup();
  await runQueued(orch);
  const name = orch.state.active.name;
  await sim.docker.containerRestart(name);
  assert.equal(sim.app(name).phase, "active");
});

test("failed snapshot restore is reported in the rollback reason", async () => {
  const { sim, orch } = await setup({ profiles: { [NEW_IMG]: { healthy: false } } });
  sim.restoreCode = 1;
  await runQueued(orch);
  assert.match(orch.state.update.lastReason, /DB snapshot restore FAILED/);
});

test("unexpected Docker error after commit still rolls back", async () => {
  const { sim, orch, oldName } = await setup({ profiles: { [NEW_IMG]: { startPolls: 5 } } });
  // Docker fails while the new container is starting (after commit).
  sim.failInspect = (id) => id.startsWith("sparky-app-3.7.0-") && orch.state.update?.phase === "starting";
  await runQueued(orch);
  assert.equal(orch.state.update.phase, "rolled-back");
  assert.match(orch.state.update.lastReason, /Unexpected orchestrator error: docker daemon hiccup/);
  assert.equal(orch.state.active.name, oldName);
});

// ---- queue / cancel ----------------------------------------------------------------

test("cancel a queued update", async () => {
  const { orch } = await setup({ start: "2026-10-15T12:00:00Z" });
  await orch.queueUpdate();
  assert.deepEqual(await orch.cancelUpdate(), { state: "canceled" });
  assert.equal(orch.state.update.phase, "canceled");
  await assert.rejects(orch.cancelUpdate(), (e) => e.status === 409);
});

test("cancel during the drain resumes the old version", async () => {
  const { sim, orch, oldName } = await setup({ profiles: { [OLD_IMG]: { drainPolls: 50 } } });
  await orch.queueUpdate();
  await settle();
  const pending = orch.tick();
  for (let i = 0; i < 200 && orch.state.update.phase !== "draining"; i++) await settle();
  assert.equal(orch.state.update.phase, "draining");
  await assert.rejects(orch.queueUpdate(), (e) => e.status === 409 && /in progress/.test(e.message));
  assert.deepEqual(await orch.cancelUpdate(), { state: "canceling" });
  await pending;
  assert.equal(orch.state.update.phase, "canceled");
  assert.ok(sim.calls.some((c) => c[2] === "/handover/resume"));
  assert.equal(sim.app(oldName).phase, "active");
  assert.equal(sim.apps().length, 1);
});

test("cannot cancel once the handover is committed", async () => {
  const { orch } = await setup({ profiles: { [NEW_IMG]: { startPolls: 20 } } });
  await orch.queueUpdate();
  await settle();
  const pending = orch.tick();
  for (let i = 0; i < 400 && orch.state.update.phase !== "starting"; i++) await settle();
  await assert.rejects(orch.cancelUpdate(), (e) => e.status === 409 && /committed/.test(e.message));
  await pending;
  assert.equal(orch.state.update.phase, "done");
});

test("queueing when already up to date is refused", async () => {
  const { sim, orch } = await setup();
  sim.latest = { ...TARGET, version: "3.6.0" };
  await assert.rejects(orch.queueUpdate(), (e) => e.status === 409 && /up to date/.test(e.message));
});

test("release source errors map to 502", async () => {
  const sim = new Sim();
  const orch = createOrchestrator({ ...sim.deps(), releaseSource: { latest: async () => Promise.reject(new Error("offline")) } });
  await orch.init();
  await assert.rejects(orch.queueUpdate(), (e) => e.status === 502 && /offline/.test(e.message));
  const check = await orch.check();
  assert.equal(check.latest, null);
  assert.equal(check.latestError, "offline");
});

test("check reports current, latest, availability and the window", async () => {
  const { orch } = await setup({ start: "2026-10-15T12:00:00Z" });
  const c = await orch.check();
  assert.deepEqual(c.current, { version: "3.6.0", digest: digest("1") });
  assert.deepEqual(c.latest, { version: "3.7.0", digest: digest("2") });
  assert.equal(c.available, true);
  assert.deepEqual(c.window, { spec: "17:00-03:00", tz: "UTC", open: false, nextOpen: "2026-10-15T17:00:00.000Z" });
  assert.equal(c.update.phase, "idle");
});

// ---- reboot mid-update (reconcile + executor) -------------------------------------

test("reboot during verifying: new container dropped, DB restored, old version restarted, update requeued", async () => {
  const { sim, orch, oldName } = await setup({ profiles: { [NEW_IMG]: { startPolls: 1000 } } });
  await orch.queueUpdate();
  await settle();
  const pending = orch.tick();
  for (let i = 0; i < 400 && orch.state.update.phase !== "starting"; i++) await settle();
  // Freeze a copy of the persisted state as if the host lost power here.
  const persisted = structuredClone(sim.saved.state);
  persisted.update.phase = "verifying";
  sim.profiles[NEW_IMG].startPolls = 0;
  await pending; // let the in-memory run finish so the sim is quiet
  // Reconstruct the post-reboot world: old released+stopped, new present.
  const newName = persisted.update.standbyName;
  sim.saved.state = persisted;
  sim.containers.clear();
  sim.containers.set(oldName, { name: oldName, image: OLD_IMG, env: {}, running: false, phase: "stopped", restart: "no", networks: [], created: 1 });
  sim.containers.set(newName, { name: newName, image: NEW_IMG, env: {}, running: false, phase: "stopped", restart: "no", networks: [], created: 2 });
  sim.restores = [];
  sim.calls = [];

  const rebooted = createOrchestrator(sim.deps());
  await rebooted.init();
  assert.equal(rebooted.state.update.phase, "queued");
  assert.match(rebooted.state.update.lastReason, /rolled back/);
  assert.equal(rebooted.state.active.name, oldName);
  assert.equal(sim.app(newName), undefined);
  assert.equal(sim.restores.length, 1);
  assert.equal(sim.app(oldName).running, true);
  assert.equal(sim.app(oldName).restart, "unless-stopped");
  assert.equal(sim.saved.route.name, oldName);
});
