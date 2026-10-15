import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createDrainController, DRAIN_MESSAGE } from "../src/services/lifecycle/drain.js";

function controller({ monitors = 0, step = 1, pollMs = 5 } = {}) {
  const state = { monitors, step };
  const drain = createDrainController({
    activeMonitors: () => state.monitors,
    readStep: async () => {
      if (state.step instanceof Error) throw state.step;
      return state.step;
    },
    pollMs,
  });
  return { drain, state };
}

async function serve(drain) {
  const app = express();
  app.use(express.json());
  app.use("/api/pull", drain.middleware, (req, res) => res.json({ ok: true, path: req.path }));
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/pull`;
  const post = (path, body) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { server, base, post };
}

test("middleware passes everything through when not draining", async () => {
  const { drain } = controller();
  const { server, post } = await serve(drain);
  try {
    assert.equal((await post("/field", { field: "user", value: "Alice" })).status, 200);
  } finally {
    server.close();
  }
});

test("while draining, only new checkout starts (field=user) get 503", async () => {
  const { drain, state } = controller({ monitors: 1, step: 3 });
  const { server, base, post } = await serve(drain);
  try {
    const pending = drain.start(10_000);
    const blocked = await post("/field", { field: "user", value: "Alice" });
    assert.equal(blocked.status, 503);
    assert.deepEqual(await blocked.json(), { error: DRAIN_MESSAGE, updating: true });
    assert.equal(blocked.headers.get("retry-after"), "300");

    // An operator already mid-checkout can continue.
    assert.equal((await post("/field", { field: "project", value: "MO-1" })).status, 200);
    assert.equal((await post("/field", { field: "item", value: "SKU-1" })).status, 200);
    assert.equal((await post("/reset", {})).status, 200);
    assert.equal((await fetch(base + "/monitor/s1")).status, 200);

    state.monitors = 0;
    state.step = 1;
    assert.equal((await pending).result, "drained");
  } finally {
    server.close();
  }
});

test("drained only once no monitors are open AND the PLC is back at step 1", async () => {
  const { drain, state } = controller({ monitors: 1, step: 1 });
  let settled = null;
  drain.start(10_000).then((r) => (settled = r));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(settled, null, "an open monitor keeps the drain waiting");
  state.monitors = 0;
  state.step = 4;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(settled, null, "a checkout mid-flow at the PLC keeps the drain waiting");
  state.step = 1;
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(settled, { result: "drained", activeMonitors: 0, step: 1 });
  assert.equal(drain.isDraining(), true, "stays draining until commit or resume");
});

test("an unreadable PLC step counts as idle when no monitors are open", async () => {
  const { drain } = controller({ monitors: 0, step: new Error("bridge down") });
  assert.deepEqual(await drain.start(10_000), { result: "drained", activeMonitors: 0, step: null });
});

test("deadline reached: times out and resumes normal service by itself", async () => {
  const { drain } = controller({ monitors: 2, step: 3 });
  const result = await drain.start(40);
  assert.deepEqual(result, { result: "timeout", activeMonitors: 2, step: 3 });
  assert.equal(drain.isDraining(), false);
});

test("resume cancels an in-flight drain and clears drain mode", async () => {
  const { drain } = controller({ monitors: 1, step: 3 });
  const pending = drain.start(10_000);
  await new Promise((r) => setTimeout(r, 15));
  drain.resume();
  assert.equal((await pending).result, "resumed");
  assert.equal(drain.isDraining(), false);
});

test("resume after drained clears drain mode", async () => {
  const { drain } = controller();
  assert.equal((await drain.start(1000)).result, "drained");
  drain.resume();
  assert.equal(drain.isDraining(), false);
});

test("concurrent start() calls share one drain", async () => {
  const { drain } = controller();
  const a = drain.start(1000);
  const b = drain.start(1000);
  assert.equal(a, b);
  await a;
});
