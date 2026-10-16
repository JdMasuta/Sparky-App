// System routes against a fake update orchestrator: container vs native
// deployment, admin/CSRF gating, and orchestrator error mapping.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createToken } from "../src/services/auth/crypto.js";

const SECRET = "test-session-secret";
const ORCH_TOKEN = "orch-token-for-this-container";

let app;
let appServer;
let base;
let orch; // fake orchestrator
let orchUrl;
const orchCalls = [];
let orchReply = {}; // "METHOD /path" -> [status, body]

const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

before(async () => {
  process.env.SESSION_SECRET = SECRET;
  orch = http.createServer((req, res) => {
    orchCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    const [status, body] = orchReply[`${req.method} ${req.url}`] ?? [404, { error: "Not found" }];
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  orchUrl = `http://127.0.0.1:${await listen(orch)}`;

  const { requireAdmin } = await import("../src/services/middleware/requireAdmin.js");
  const { default: systemRoutes } = await import("../src/services/routes/systemRoutes.js");
  app = express();
  app.use(express.json());
  app.use("/api/system", requireAdmin, systemRoutes);
  appServer = http.createServer(app);
  base = `http://127.0.0.1:${await listen(appServer)}`;
});

after(() => {
  appServer?.close();
  orch?.close();
});

beforeEach(() => {
  orchCalls.length = 0;
  orchReply = {};
  process.env.SPARKY_ORCH_URL = orchUrl;
  process.env.SPARKY_ORCH_TOKEN = ORCH_TOKEN;
  process.env.SPARKY_CONTAINER_NAME = "sparky-app-3.7.0-abc123";
});

const cookie = () => `sparky_session=${encodeURIComponent(createToken({ sub: "admin" }, SECRET, 60_000))}`;
const call = (method, path, { auth = true, csrf = true } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(auth ? { Cookie: cookie() } : {}),
      ...(csrf ? { "X-Requested-By": "sparky" } : {}),
    },
  });

test("update endpoints require an admin session and the CSRF header", async () => {
  for (const [m, p] of [["GET", "/api/system/update/check"], ["POST", "/api/system/update"], ["DELETE", "/api/system/update"]]) {
    assert.equal((await call(m, p, { auth: false })).status, 401, `${m} ${p}`);
  }
  assert.equal((await call("POST", "/api/system/update", { csrf: false })).status, 403);
  assert.equal((await call("DELETE", "/api/system/update", { csrf: false })).status, 403);
  assert.equal(orchCalls.length, 0, "nothing reached the orchestrator");
});

test("info reports the container deployment", async () => {
  const info = await (await call("GET", "/api/system/info")).json();
  assert.equal(info.deployment, "container");
  assert.equal(info.container, "sparky-app-3.7.0-abc123");
});

test("info reports the native deployment when no orchestrator is configured", async () => {
  delete process.env.SPARKY_ORCH_URL;
  delete process.env.SPARKY_CONTAINER_NAME;
  const info = await (await call("GET", "/api/system/info")).json();
  assert.equal(info.deployment, "native");
  assert.equal(info.container, null);
});

test("check proxies the orchestrator with this container's token and adds active checkouts", async () => {
  orchReply["GET /v1/check"] = [200, { current: { version: "3.6.0" }, latest: { version: "3.7.0" }, available: true }];
  const res = await call("GET", "/api/system/update/check");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    current: { version: "3.6.0" },
    latest: { version: "3.7.0" },
    available: true,
    activeMonitors: 0,
  });
  assert.deepEqual(orchCalls, [{ method: "GET", url: "/v1/check", auth: `Bearer ${ORCH_TOKEN}` }]);
});

test("update queues with the orchestrator (202)", async () => {
  orchReply["POST /v1/update"] = [202, { updateId: "u-1", state: "queued", notBefore: "2026-10-15T17:00:00.000Z" }];
  const res = await call("POST", "/api/system/update");
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { updateId: "u-1", state: "queued", notBefore: "2026-10-15T17:00:00.000Z" });
});

test("cancel: 200 when canceled, 202 while canceling", async () => {
  orchReply["DELETE /v1/update"] = [200, { state: "canceled" }];
  assert.equal((await call("DELETE", "/api/system/update")).status, 200);
  orchReply["DELETE /v1/update"] = [202, { state: "canceling" }];
  const res = await call("DELETE", "/api/system/update");
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { state: "canceling" });
});

test("orchestrator conflicts pass through as 409 with their message", async () => {
  orchReply["POST /v1/update"] = [409, { error: "Already up to date (3.7.0)" }];
  const res = await call("POST", "/api/system/update");
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "Already up to date (3.7.0)" });
});

test("other orchestrator errors become 502", async () => {
  orchReply["POST /v1/update"] = [502, { error: "Could not read the latest release: offline" }];
  const res = await call("POST", "/api/system/update");
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /offline/);
  orchReply["GET /v1/check"] = [401, { error: "Unauthorized" }];
  assert.equal((await call("GET", "/api/system/update/check")).status, 502);
});

test("an unreachable orchestrator is 503", async () => {
  process.env.SPARKY_ORCH_URL = "http://127.0.0.1:1";
  const res = await call("GET", "/api/system/update/check");
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "Update service is unreachable" });
});

test("native deployment: check and cancel are 501; update keeps the legacy behavior", async () => {
  delete process.env.SPARKY_ORCH_URL;
  const check = await call("GET", "/api/system/update/check");
  assert.equal(check.status, 501);
  assert.equal((await check.json()).deployment, "native");
  assert.equal((await call("DELETE", "/api/system/update")).status, 501);
  // Legacy path: on non-Windows hosts it reports that updates run on the device.
  if (process.platform !== "win32") {
    const update = await call("POST", "/api/system/update");
    assert.equal(update.status, 501);
    assert.match((await update.json()).error, /Windows edge device/);
  }
  assert.equal(orchCalls.length, 0);
});
