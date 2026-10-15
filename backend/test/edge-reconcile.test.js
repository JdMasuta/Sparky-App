import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile } from "../../deploy/edge/reconcile.mjs";

const NOW = Date.parse("2026-10-15T22:00:00Z");
const OLD = { name: "sparky-app-3.6.0-aaaaaa", image: "repo@sha256:old", digest: "sha256:old", version: "3.6.0" };
const NEW = "sparky-app-3.7.0-bbbbbb";
const c = (name, running = true, created = 1, image = "repo@sha256:x") => ({ name, running, image, created });

const state = (update = null, active = OLD) => ({
  version: 1,
  secret: "s",
  active,
  previous: null,
  update,
  history: [],
});
const update = (phase) => ({
  id: "u-1",
  phase,
  target: { version: "3.7.0" },
  notBefore: "2026-10-15T22:00:00.000Z",
  standbyName: NEW,
  handoverToken: "tok",
  cancelRequested: false,
});
const types = (r) => r.actions.map((a) => `${a.type}:${a.name ?? a.image ?? ""}`);

test("steady state: active running, nothing else to do but enforce its restart policy", () => {
  const r = reconcile({ state: state(), containers: [c(OLD.name)], initialImage: "init", now: NOW });
  assert.deepEqual(types(r), [`setRestart:${OLD.name}`, `ensureRunning:${OLD.name}`]);
  assert.deepEqual(r.state.active, OLD);
});

test("steady state: stray app containers are removed", () => {
  const r = reconcile({ state: state(), containers: [c(OLD.name), c("sparky-app-x-111111", false)], initialImage: "init", now: NOW });
  assert.ok(types(r).includes("remove:sparky-app-x-111111"));
  assert.ok(!types(r).includes(`remove:${OLD.name}`));
});

test("first boot: no state and no containers -> bootstrap the initial image", () => {
  const r = reconcile({ state: state(null, null), containers: [], initialImage: "repo@sha256:init", now: NOW });
  assert.deepEqual(r.actions, [{ type: "bootstrap", image: "repo@sha256:init", version: null }]);
  assert.equal(r.state.active, null);
});

test("lost state but an app container exists -> recreate from that container's image (no downgrade)", () => {
  const containers = [c("sparky-app-3.5.0-aaa111", false, 1, "repo@sha256:older"), c("sparky-app-3.7.0-bbb222", true, 2, "repo@sha256:newer")];
  const r = reconcile({ state: state(null, null), containers, initialImage: "repo@sha256:init", now: NOW });
  assert.deepEqual(r.actions.at(-1), { type: "bootstrap", image: "repo@sha256:newer", version: null });
  assert.equal(r.actions.filter((a) => a.type === "remove").length, 2);
});

test("active container recorded but gone -> recreate from its recorded image", () => {
  const r = reconcile({ state: state(), containers: [], initialImage: "init", now: NOW });
  assert.deepEqual(r.actions, [{ type: "bootstrap", image: OLD.image, version: "3.6.0" }]);
});

test("no image anywhere is an error", () => {
  assert.throws(() => reconcile({ state: state(null, null), containers: [], initialImage: "", now: NOW }), /SPARKY_APP_IMAGE/);
});

for (const phase of ["preparing", "standby"]) {
  test(`reboot during ${phase}: drop the standby, keep the old container, requeue`, () => {
    const r = reconcile({ state: state(update(phase)), containers: [c(OLD.name, false), c(NEW)], initialImage: "init", now: NOW });
    assert.deepEqual(types(r), [`remove:${NEW}`, `setRestart:${OLD.name}`, `ensureRunning:${OLD.name}`]);
    assert.equal(r.state.update.phase, "queued");
    assert.equal(r.state.update.notBefore, new Date(NOW).toISOString());
    assert.equal(r.state.update.standbyName, null);
    assert.equal(r.state.update.handoverToken, null);
    assert.match(r.state.update.lastReason, /before the handover/);
  });
}

test("restart during draining: also tell the old container to resume", () => {
  const r = reconcile({ state: state(update("draining")), containers: [c(OLD.name), c(NEW)], initialImage: "init", now: NOW });
  assert.deepEqual(types(r), [`remove:${NEW}`, `resume:${OLD.name}`, `setRestart:${OLD.name}`, `ensureRunning:${OLD.name}`]);
  assert.equal(r.state.update.phase, "queued");
});

for (const phase of ["committed", "starting", "verifying"]) {
  test(`reboot during ${phase}: drop the new container, roll the DB back, restart the old one, requeue`, () => {
    const r = reconcile({ state: state(update(phase)), containers: [c(OLD.name, false), c(NEW, false)], initialImage: "init", now: NOW });
    assert.deepEqual(r.actions, [
      { type: "remove", name: NEW },
      { type: "rollbackDb", name: OLD.name, updateId: "u-1", image: OLD.image },
      { type: "setRestart", name: OLD.name, policy: "unless-stopped" },
      { type: "ensureRunning", name: OLD.name },
    ]);
    assert.equal(r.state.update.phase, "queued");
    assert.match(r.state.update.lastReason, /rolled back/);
    assert.deepEqual(r.state.active, OLD, "the old version stays active");
  });
}

test("after commit with the old container gone: restore the DB, then recreate the old version", () => {
  const r = reconcile({ state: state(update("verifying")), containers: [c(NEW)], initialImage: "init", now: NOW });
  assert.deepEqual(r.actions, [
    { type: "remove", name: NEW },
    { type: "rollbackDb", name: null, updateId: "u-1", image: OLD.image },
    { type: "bootstrap", image: OLD.image, version: "3.6.0" },
  ]);
});

for (const phase of ["queued", "postponed", "done", "failed", "rolled-back", "canceled"]) {
  test(`${phase} update is left as is`, () => {
    const r = reconcile({ state: state(update(phase)), containers: [c(OLD.name)], initialImage: "init", now: NOW });
    assert.equal(r.state.update.phase, phase);
    assert.deepEqual(types(r), [`setRestart:${OLD.name}`, `ensureRunning:${OLD.name}`]);
  });
}

test("reconcile does not mutate its input", () => {
  const s = state(update("draining"));
  const before = JSON.stringify(s);
  reconcile({ state: s, containers: [c(OLD.name)], initialImage: "init", now: NOW });
  assert.equal(JSON.stringify(s), before);
});
