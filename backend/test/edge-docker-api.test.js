import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDockerClient, demuxLogs, streamError, DockerError } from "../../deploy/edge/docker-api.mjs";

let server;
let socketPath;
let docker;
const requests = [];
const routes = new Map(); // "METHOD /path" -> (req, body) => [status, body]

before(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-docker-"));
  socketPath = path.join(dir, "docker.sock");
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      const key = `${req.method} ${req.url.split("?")[0]}`;
      const handler = routes.get(key);
      const [status, payload, headers] = handler ? handler(req, body) : [404, { message: `no route ${key}` }];
      res.writeHead(status, headers || { "Content-Type": "application/json" });
      res.end(Buffer.isBuffer(payload) || typeof payload === "string" ? payload : JSON.stringify(payload));
    });
  });
  await new Promise((r) => server.listen(socketPath, r));
  routes.set("GET /version", () => [200, { ApiVersion: "1.45" }]);
  docker = createDockerClient({ socketPath, timeoutMs: 5000 });
});

after(() => server?.close());

test("negotiates the API version once and prefixes every call", async () => {
  requests.length = 0;
  routes.set("GET /v1.45/containers/abc/json", () => [200, { Id: "abc", State: { Running: true } }]);
  assert.equal((await docker.containerInspect("abc")).Id, "abc");
  await docker.containerInspect("abc");
  assert.deepEqual(requests.map((r) => r.url), ["/version", "/v1.45/containers/abc/json", "/v1.45/containers/abc/json"]);
});

test("inspect returns null for missing images and containers", async () => {
  assert.equal(await docker.containerInspect("missing"), null);
  assert.equal(await docker.imageInspect("missing:tag"), null);
});

test("errors carry the status and Docker's message", async () => {
  routes.set("POST /v1.45/containers/create", () => [409, { message: "Conflict. The container name is already in use" }]);
  await assert.rejects(docker.containerCreate("dup", {}), (err) => err instanceof DockerError && err.status === 409 && /already in use/.test(err.message));
});

test("create sends the name and body; start tolerates 304", async () => {
  requests.length = 0;
  routes.set("POST /v1.45/containers/create", () => [201, { Id: "new-id" }]);
  routes.set("POST /v1.45/containers/new-id/start", () => [304, ""]);
  assert.equal(await docker.containerCreate("sparky-app-1", { Image: "img" }), "new-id");
  await docker.containerStart("new-id");
  assert.equal(requests[0].url, "/v1.45/containers/create?name=sparky-app-1");
  assert.deepEqual(requests[0].body, { Image: "img" });
});

test("pull splits repo and digest and detects errors reported inside the stream", async () => {
  requests.length = 0;
  routes.set("POST /v1.45/images/create", (req) =>
    req.url.includes("bad") ? [200, '{"status":"Pulling"}\n{"error":"manifest unknown","errorDetail":{"message":"manifest unknown"}}\n'] : [200, '{"status":"Downloaded"}\n'],
  );
  const digest = "sha256:" + "a".repeat(64);
  await docker.imagePull(`ghcr.io/o/app@${digest}`);
  assert.equal(requests[0].url, `/v1.45/images/create?fromImage=${encodeURIComponent("ghcr.io/o/app")}&tag=${encodeURIComponent(digest)}`);
  await docker.imagePull("localhost:5000/app:9.0.0");
  assert.equal(requests[1].url, `/v1.45/images/create?fromImage=${encodeURIComponent("localhost:5000/app")}&tag=9.0.0`);
  await assert.rejects(docker.imagePull("ghcr.io/o/bad:1"), /manifest unknown/);
});

test("list filters by label; logs are demultiplexed", async () => {
  requests.length = 0;
  routes.set("GET /v1.45/containers/json", () => [200, [{ Names: ["/a"] }]]);
  const frame = (stream, text) => {
    const payload = Buffer.from(text);
    const header = Buffer.alloc(8);
    header[0] = stream;
    header.writeUInt32BE(payload.length, 4);
    return Buffer.concat([header, payload]);
  };
  routes.set("GET /v1.45/containers/a/logs", () => [200, Buffer.concat([frame(1, "out\n"), frame(2, "err\n")]), { "Content-Type": "application/vnd.docker.raw-stream" }]);
  assert.deepEqual(await docker.containerList({ labels: ["sparky.role=app"] }), [{ Names: ["/a"] }]);
  assert.equal(requests[0].url, `/v1.45/containers/json?all=1&filters=${encodeURIComponent('{"label":["sparky.role=app"]}')}`);
  assert.equal(await docker.containerLogs("a", 50), "out\nerr\n");
});

test("remove never deletes volumes and tolerates missing containers", async () => {
  requests.length = 0;
  routes.set("DELETE /v1.45/containers/gone", () => [404, { message: "No such container" }]);
  assert.equal(await docker.containerRemove("gone"), false);
  assert.ok(!requests[0].url.includes("v="), "must not pass v=1 (volume removal)");
});

test("the client exposes no volume or exec operations", () => {
  const names = Object.keys(docker);
  assert.ok(names.length > 10);
  for (const name of names) assert.doesNotMatch(name, /volume|exec/i);
});

test("demuxLogs and streamError helpers", () => {
  assert.equal(demuxLogs(Buffer.from("plain tty output")), "plain tty output");
  assert.equal(demuxLogs(Buffer.alloc(0)), "");
  assert.equal(streamError('{"status":"ok"}\n'), null);
  assert.equal(streamError('{"errorDetail":{"message":"denied"}}'), "denied");
});
