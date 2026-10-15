import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createShutdown } from "../src/init/lifecycle.js";

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const url = (server, path = "/") => `http://127.0.0.1:${server.address().port}${path}`;

test("shutdown stops cron, closes the server, then the DB, then exits 0", async () => {
  const events = [];
  const server = await listen((req, res) => res.end("ok"));
  const shutdown = createShutdown({
    server,
    closeDatabase: () => events.push("db"),
    cronTasks: [{ stop: () => events.push("cron") }],
    log: () => {},
    exit: (code) => events.push(`exit:${code}`),
  });
  server.on("close", () => events.push("server"));
  await shutdown();
  assert.deepEqual(events, ["cron", "server", "db", "exit:0"]);
});

test("in-flight requests finish before the DB is closed", async () => {
  const events = [];
  let release;
  const server = await listen((req, res) => {
    events.push("request-start");
    release = () => {
      events.push("request-end");
      res.end("done");
    };
  });
  const shutdown = createShutdown({
    server,
    closeDatabase: () => events.push("db"),
    log: () => {},
    exit: () => events.push("exit"),
  });

  const response = fetch(url(server)).then((r) => r.text());
  while (!release) await new Promise((r) => setTimeout(r, 5));
  const done = shutdown();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!events.includes("db"), "DB must stay open while a request is in flight");
  release();
  assert.equal(await response, "done");
  await done;
  assert.deepEqual(events, ["request-start", "request-end", "db", "exit"]);
});

test("lingering connections are force-closed after graceMs", async () => {
  const server = await listen(() => {
    /* never responds, like a checkout monitor long-poll */
  });
  let exited = false;
  const shutdown = createShutdown({
    server,
    closeDatabase: () => {},
    log: () => {},
    exit: () => (exited = true),
    graceMs: 50,
  });
  const hanging = fetch(url(server)).catch(() => "aborted");
  await new Promise((r) => setTimeout(r, 20));
  const started = Date.now();
  await shutdown();
  assert.ok(exited);
  assert.ok(Date.now() - started < 2000, "shutdown should not wait for the hanging request");
  assert.equal(await hanging, "aborted");
});

test("shutdown is idempotent", async () => {
  let closes = 0;
  let exits = 0;
  const server = await listen((req, res) => res.end());
  const shutdown = createShutdown({
    server,
    closeDatabase: () => closes++,
    log: () => {},
    exit: () => exits++,
  });
  await Promise.all([shutdown(), shutdown()]);
  await shutdown();
  assert.equal(closes, 1);
  assert.equal(exits, 1);
});

test("a failing DB close exits non-zero", async () => {
  let code;
  const server = await listen((req, res) => res.end());
  const shutdown = createShutdown({
    server,
    closeDatabase: () => {
      throw new Error("boom");
    },
    log: () => {},
    exit: (c) => (code = c),
  });
  await shutdown();
  assert.equal(code, 1);
});
