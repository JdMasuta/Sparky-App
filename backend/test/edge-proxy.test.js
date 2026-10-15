import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProxy, stripHopByHop } from "../../deploy/edge/proxy.mjs";

let routeDir;
let upstream;
let proxy;
let base;
const seen = [];

const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

async function setRoute(route) {
  // New file + rename so the proxy sees a new mtime, like the orchestrator's atomic writes.
  const tmp = path.join(routeDir, ".active.tmp");
  await fs.writeFile(tmp, JSON.stringify(route));
  await fs.rename(tmp, path.join(routeDir, "active.json"));
  await new Promise((r) => setTimeout(r, 15));
}

before(async () => {
  routeDir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-route-"));
  upstream = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url === "/slow") return setTimeout(() => res.end("slow-done"), 300);
      res.writeHead(201, { "X-Upstream": "yes", Connection: "X-Up-Hop", "X-Up-Hop": "1" });
      res.end(JSON.stringify({ ok: true, url: req.url, body }));
    });
  });
  const upPort = await listen(upstream);
  proxy = createProxy({ routeDir });
  base = `http://127.0.0.1:${await listen(proxy)}`;
  await setRoute({ name: "127.0.0.1", port: upPort });
});

after(() => {
  proxy?.close();
  upstream?.close();
});

test("forwards method, path, query and body to the active app", async () => {
  const res = await fetch(`${base}/api/pull/field?x=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field: "user" }),
  });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("x-upstream"), "yes");
  assert.deepEqual(await res.json(), { ok: true, url: "/api/pull/field?x=1", body: '{"field":"user"}' });
});

test("X-Forwarded-For is overwritten with the real peer, never appended", async () => {
  seen.length = 0;
  await fetch(`${base}/api/x`, { headers: { "X-Forwarded-For": "6.6.6.6", Forwarded: "for=6.6.6.6", "X-Real-IP": "6.6.6.6" } });
  const h = seen.at(-1).headers;
  assert.equal(h["x-forwarded-for"], "127.0.0.1");
  assert.equal(h["x-forwarded-proto"], "http");
  assert.equal(h.forwarded, undefined);
  assert.equal(h["x-real-ip"], undefined);
});

// fetch() refuses to set Connection, so use http.request for raw headers.
function rawGet(url, headers) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        res.resume();
        res.on("end", () => resolve(res));
      })
      .on("error", reject);
  });
}

test("hop-by-hop headers are stripped in both directions", async () => {
  seen.length = 0;
  const res = await rawGet(`${base}/api/y`, { "X-Secret-Hop": "1", Connection: "X-Secret-Hop" });
  assert.equal(res.statusCode, 201);
  assert.equal(seen.at(-1).headers["x-secret-hop"], undefined);
  assert.equal(res.headers["x-upstream"], "yes");
  assert.equal(res.headers["x-up-hop"], undefined, "upstream hop-by-hop header leaked to the client");
  assert.deepEqual(stripHopByHop({ connection: "foo", foo: "1", bar: "2", "transfer-encoding": "chunked" }), { bar: "2" });
});

test("/__edge/status is served from the route volume and never forwarded", async () => {
  await fs.writeFile(path.join(routeDir, "status.json"), JSON.stringify({ phase: "draining" }));
  seen.length = 0;
  const res = await fetch(`${base}/__edge/status`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { phase: "draining" });
  assert.equal((await fetch(`${base}/__edge/status`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${base}/__edge/control`)).status, 404);
  assert.equal((await fetch(`${base}/__edge`)).status, 404);
  assert.equal(seen.length, 0, "edge paths must not reach the app");
});

test("long requests are not cut off by a proxy timeout", async () => {
  const res = await fetch(`${base}/slow`);
  assert.equal(await res.text(), "slow-done");
  assert.equal(proxy.requestTimeout, 0);
});

test("no active route: 503 JSON for the API, auto-refresh HTML for pages", async () => {
  await setRoute({ name: null, port: null });
  const api = await fetch(`${base}/api/pull/status`);
  assert.equal(api.status, 503);
  assert.equal(api.headers.get("retry-after"), "5");
  assert.deepEqual(Object.keys(await api.json()).sort(), ["error", "updating"]);
  const page = await fetch(`${base}/checkout`, { headers: { Accept: "text/html" } });
  assert.equal(page.status, 503);
  assert.match(await page.text(), /http-equiv="refresh"/);
});

test("unreachable app: 503 updating response, then recovers when the route changes", async () => {
  const dead = http.createServer();
  const deadPort = await listen(dead);
  dead.close();
  await setRoute({ name: "127.0.0.1", port: deadPort });
  const res = await fetch(`${base}/api/pull/status`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).updating, true);
  await setRoute({ name: "127.0.0.1", port: upstream.address().port });
  assert.equal((await fetch(`${base}/api/again`)).status, 201);
});
