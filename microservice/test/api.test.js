import "./setup-env.js"; // must precede server.js — pins env before dotenv runs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import { SimDriver } from "../src/driver/simDriver.js";

let server;
let base;

before(async () => {
  const driver = new SimDriver({ simTickMs: 5, simDefaultTarget: 100, simDefaultRate: 10 });
  await driver.connect();
  const app = createApp(driver);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server && server.close());

const post = (path, body) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

test("GET /health reports sim mode", async () => {
  const res = await fetch(base + "/health");
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.status, "ok");
  assert.equal(json.mode, "sim");
});

test("GET /status reports connected", async () => {
  const json = await (await fetch(base + "/status")).json();
  assert.equal(json.connected, true);
  assert.equal(json.mode, "sim");
});

test("batch write then read round-trips handshake tags", async () => {
  await post("/sim/reset");
  const w = await post("/batch/write", { tags: { userName: "Bob", stepNumber: 2 } });
  assert.equal(w.status, 200);
  const r = await (await post("/batch/read", { tags: ["userName", "stepNumber"] })).json();
  assert.equal(r.results.userName, "Bob");
  assert.equal(r.results.stepNumber, 2);
});

test("batch/read rejects a non-array tags body", async () => {
  const res = await post("/batch/read", { tags: "userName" });
  assert.equal(res.status, 400);
});

test("full sim pull: start -> encoder ramps -> completeRequest true", async () => {
  await post("/sim/reset");
  const started = await (await post("/sim/pull/start", { targetQuantity: 20, rate: 10 })).json();
  assert.equal(started.ok, true);
  assert.equal(started.target, 20);

  let done = false;
  let finalQty = 0;
  for (let i = 0; i < 100 && !done; i++) {
    const r = await (await post("/batch/read", { tags: ["completeRequest", "quantity"] })).json();
    done = r.results.completeRequest === true;
    finalQty = r.results.quantity;
    if (!done) await new Promise((res) => setTimeout(res, 5));
  }
  assert.equal(done, true);
  assert.equal(finalQty, 20);
});

test("GET /sim/state returns the store snapshot", async () => {
  const state = await (await fetch(base + "/sim/state")).json();
  assert.equal(state.mode, "sim");
  assert.ok("tags" in state);
});
