import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createControlServer } from "../../deploy/edge/control-server.mjs";

const GOOD = "Bearer good-token";
let server;
let base;
const calls = [];
let queueImpl = async () => ({ updateId: "u-1", state: "queued", notBefore: "2026-10-15T17:00:00.000Z" });
let cancelImpl = async () => ({ state: "canceled" });

const orchestrator = {
  authorize: (h) => h === GOOD,
  check: async () => (calls.push("check"), { available: true }),
  queueUpdate: async () => (calls.push("queue"), queueImpl()),
  cancelUpdate: async () => (calls.push("cancel"), cancelImpl()),
  status: () => (calls.push("status"), { phase: "idle" }),
};

before(async () => {
  server = createControlServer({ orchestrator });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

const call = (method, path, auth = GOOD) =>
  fetch(base + path, { method, headers: auth ? { Authorization: auth } : {} });

test("every verb requires the active container's token", async () => {
  calls.length = 0;
  for (const [m, p] of [["GET", "/v1/check"], ["POST", "/v1/update"], ["DELETE", "/v1/update"], ["GET", "/v1/status"]]) {
    assert.equal((await call(m, p, null)).status, 401, `${m} ${p} without token`);
    assert.equal((await call(m, p, "Bearer wrong")).status, 401, `${m} ${p} wrong token`);
  }
  assert.deepEqual(calls, [], "nothing reached the orchestrator");
});

test("routes", async () => {
  assert.deepEqual(await (await call("GET", "/v1/check")).json(), { available: true });
  const q = await call("POST", "/v1/update");
  assert.equal(q.status, 202);
  assert.equal((await q.json()).state, "queued");
  assert.equal((await call("DELETE", "/v1/update")).status, 200);
  cancelImpl = async () => ({ state: "canceling" });
  assert.equal((await call("DELETE", "/v1/update")).status, 202);
  assert.deepEqual(await (await call("GET", "/v1/status")).json(), { phase: "idle" });
});

test("unknown routes and methods are 404, even with a token", async () => {
  assert.equal((await call("GET", "/v1/update")).status, 404);
  assert.equal((await call("POST", "/v1/exec")).status, 404);
  assert.equal((await call("GET", "/")).status, 404);
});

test("expected errors keep their status and message; unexpected ones are hidden", async () => {
  queueImpl = async () => Promise.reject(Object.assign(new Error("Already up to date (3.7.0)"), { status: 409 }));
  const conflict = await call("POST", "/v1/update");
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: "Already up to date (3.7.0)" });
  queueImpl = async () => Promise.reject(new Error("ENOENT /state/secret-path"));
  const crash = await call("POST", "/v1/update");
  assert.equal(crash.status, 500);
  assert.deepEqual(await crash.json(), { error: "Internal error" });
});
