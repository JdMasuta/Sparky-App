import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL,
  transition,
  initialPhase,
  acceptsProtocol,
  safeEqual,
  bearerMatches,
  validateRelease,
  validateAck,
  buildAck,
  snapshotName,
  ipInSubnet,
  pickBindAddress,
} from "../../deploy/container/handover.mjs";

const TOKEN = "t".repeat(48);

test("standby containers start in preflight, others start immediately", () => {
  assert.equal(initialPhase(true), "preflight");
  assert.equal(initialPhase(false), "starting");
});

test("new container: preflight -> standby-ready -> ack -> starting -> active", () => {
  let p = initialPhase(true);
  for (const [event, expected] of [
    ["preflight-ok", "standby-ready"],
    ["ack", "starting"],
    ["started", "active"],
  ]) {
    p = transition(p, event);
    assert.equal(p, expected);
  }
});

test("old container: release -> drained -> commit -> released", () => {
  let p = "active";
  p = transition(p, "release");
  assert.equal(p, "draining");
  p = transition(p, "drained");
  assert.equal(p, "drained");
  p = transition(p, "commit");
  assert.equal(p, "stopping");
  assert.equal(transition(p, "released"), "released");
});

test("drain timeout, resume and fail-safe all return the old container to active", () => {
  assert.equal(transition("draining", "drain-timeout"), "active");
  assert.equal(transition("draining", "resume"), "active");
  assert.equal(transition("drained", "resume"), "active");
});

test("a failed ack sends the old container back through starting", () => {
  assert.equal(transition("stopping", "ack-failed"), "starting");
  assert.equal(transition("starting", "start-fail"), "start-failed");
});

test("out-of-order events are rejected with status 409", () => {
  for (const [phase, event] of [
    ["active", "commit"], // commit before drain
    ["draining", "commit"], // commit before drained
    ["preflight", "ack"], // ack before preflight passed
    ["active", "ack"],
    ["released", "release"],
    ["preflight-failed", "preflight-ok"],
  ]) {
    assert.throws(() => transition(phase, event), (err) => err.status === 409, `${phase}+${event}`);
  }
});

test("protocol compatibility: accept any version up to our own", () => {
  assert.ok(acceptsProtocol(1));
  assert.ok(acceptsProtocol(PROTOCOL));
  assert.ok(!acceptsProtocol(PROTOCOL + 1));
  assert.ok(!acceptsProtocol(0));
  assert.ok(!acceptsProtocol("1"));
});

test("token comparison", () => {
  assert.ok(safeEqual(TOKEN, TOKEN));
  assert.ok(!safeEqual(TOKEN, TOKEN + "x"));
  assert.ok(!safeEqual("", ""));
  assert.ok(!safeEqual(undefined, TOKEN));
  assert.ok(bearerMatches(`Bearer ${TOKEN}`, TOKEN));
  assert.ok(!bearerMatches(`Bearer ${TOKEN}`, ""));
  assert.ok(!bearerMatches(TOKEN, TOKEN));
  assert.ok(!bearerMatches(undefined, TOKEN));
});

const release = (over = {}) => ({
  protocol: 1,
  updateId: "u-20261015-1",
  updateToken: TOKEN,
  successor: "sparky-app-3.7.0-ab12cd",
  drainTimeoutMs: 600000,
  ...over,
});

test("validateRelease accepts a well-formed request", () => {
  const v = validateRelease(release());
  assert.ok(v.ok);
  assert.equal(v.value.successor, "sparky-app-3.7.0-ab12cd");
  assert.equal(v.value.drainTimeoutMs, 600000);
});

test("validateRelease rejects bad fields", () => {
  for (const over of [
    { protocol: 2 },
    { updateId: "../../etc" },
    { updateToken: "short" },
    { successor: "evil host/x" },
    { drainTimeoutMs: -1 },
    { drainTimeoutMs: "abc" },
  ]) {
    const v = validateRelease(release(over));
    assert.equal(v.ok, false, JSON.stringify(over));
    assert.equal(v.status, 400);
  }
  assert.equal(validateRelease(null).ok, false);
});

const ackFor = (over = {}) => ({
  ...buildAck({
    updateId: "u-1",
    updateToken: TOKEN,
    name: "sparky-app-3.6.0-aa",
    version: "3.6.0",
    snapshot: "/data/backups/pre-u-1.sqlite",
    cleanShutdown: true,
  }),
  ...over,
});

test("validateAck accepts the expected predecessor with the right token", () => {
  const v = validateAck(ackFor(), { expectedToken: TOKEN, predecessor: "sparky-app-3.6.0-aa" });
  assert.ok(v.ok);
  assert.deepEqual(v.value.from, { name: "sparky-app-3.6.0-aa", version: "3.6.0" });
  assert.equal(v.value.cleanShutdown, true);
});

test("validateAck rejects a wrong token, wrong predecessor or unknown protocol", () => {
  const opts = { expectedToken: TOKEN, predecessor: "sparky-app-3.6.0-aa" };
  assert.equal(validateAck(ackFor({ token: "x".repeat(48) }), opts).status, 403);
  assert.equal(validateAck(ackFor({ from: { name: "other", version: "1" } }), opts).status, 403);
  assert.equal(validateAck(ackFor({ protocol: 99 }), opts).status, 400);
  assert.equal(validateAck(ackFor(), { expectedToken: "", predecessor: "sparky-app-3.6.0-aa" }).status, 403);
  assert.equal(validateAck(ackFor(), { expectedToken: TOKEN, predecessor: "" }).status, 403);
});

test("snapshot names are derived from validated update ids", () => {
  assert.equal(snapshotName("u-1"), "pre-u-1.sqlite");
});

test("ipInSubnet", () => {
  assert.ok(ipInSubnet("172.30.1.5", "172.30.1.0/24"));
  assert.ok(!ipInSubnet("172.30.2.5", "172.30.1.0/24"));
  assert.ok(ipInSubnet("10.1.2.3", "10.0.0.0/8"));
  assert.ok(ipInSubnet("1.2.3.4", "0.0.0.0/0"));
  assert.ok(!ipInSubnet("not-an-ip", "10.0.0.0/8"));
  assert.ok(!ipInSubnet("10.1.2.3", "10.0.0.0/33"));
});

test("pickBindAddress selects the control-subnet interface only", () => {
  const ifaces = {
    lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
    eth0: [{ family: "IPv4", internal: false, address: "172.31.0.4" }], // front network
    eth1: [{ family: "IPv4", internal: false, address: "172.30.1.7" }], // control network
  };
  assert.equal(pickBindAddress(ifaces, "172.30.1.0/24"), "172.30.1.7");
  assert.equal(pickBindAddress(ifaces, ""), "127.0.0.1");
  assert.throws(() => pickBindAddress(ifaces, "192.168.9.0/24"), /No network interface/);
});
