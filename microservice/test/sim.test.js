import { test } from "node:test";
import assert from "node:assert/strict";
import { SimEngine } from "../src/driver/simEngine.js";

const fastCfg = { simTickMs: 5, simDefaultTarget: 100, simDefaultRate: 10 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("initial state: idle at step 1, empty strings, zero quantity", () => {
  const e = new SimEngine(fastCfg);
  assert.equal(e.store.stepNumber, 1);
  assert.equal(e.store.userName, "");
  assert.equal(e.store.quantity, 0);
  assert.equal(e.store.completeRequest, false);
});

test("handshake: writing step + string tags advances the cycle", () => {
  const e = new SimEngine(fastCfg);
  e.write({ userName: "Alice", stepNumber: 2 });
  e.write({ moNumber: "MO-1", stepNumber: 3 });
  e.write({ itemNumber: "SKU-1", stepNumber: 4 });
  assert.equal(e.store.userName, "Alice");
  assert.equal(e.store.moNumber, "MO-1");
  assert.equal(e.store.itemNumber, "SKU-1");
  assert.equal(e.store.stepNumber, 4);
});

test("startPull ramps quantity and raises completeRequest at target", async () => {
  const e = new SimEngine(fastCfg);
  e.startPull({ targetQuantity: 30, rate: 10 });
  assert.equal(e.store.completeRequest, false);
  // wait for enough ticks (>= 3 * 5ms) to reach 30
  for (let i = 0; i < 50 && !e.store.completeRequest; i++) await sleep(5);
  assert.equal(e.store.quantity, 30);
  assert.equal(e.store.completeRequest, true);
  assert.equal(e.store.backupQuantity, 30);
});

test("quantity is capped at the target (no overshoot)", async () => {
  const e = new SimEngine({ ...fastCfg });
  e.startPull({ targetQuantity: 25, rate: 10 }); // 10,20,25
  for (let i = 0; i < 50 && !e.store.completeRequest; i++) await sleep(5);
  assert.equal(e.store.quantity, 25);
});

test("complete() finishes immediately", () => {
  const e = new SimEngine(fastCfg);
  e.startPull({ targetQuantity: 100, rate: 1 });
  e.complete();
  assert.equal(e.store.completeRequest, true);
  assert.equal(e.store.quantity, 100);
});

test("writing stepNumber=1 resets the cycle", async () => {
  const e = new SimEngine(fastCfg);
  e.startPull({ targetQuantity: 100, rate: 10 });
  await sleep(15);
  e.write({ stepNumber: 1 });
  assert.equal(e.store.quantity, 0);
  assert.equal(e.store.completeRequest, false);
  assert.equal(e.store.userName, "");
  assert.equal(e.state().pulling, false);
});

test("startPull rejects non-positive params", () => {
  const e = new SimEngine(fastCfg);
  assert.throws(() => e.startPull({ targetQuantity: 0, rate: 5 }));
  assert.throws(() => e.startPull({ targetQuantity: 10, rate: -1 }));
});

test("auto-pull starts a pull shortly after reaching step 4", async () => {
  const e = new SimEngine({
    ...fastCfg,
    simAutoPull: true,
    simAutoPullDelayMs: 10,
  });
  e.write({ stepNumber: 4 });
  await sleep(25);
  assert.equal(e.state().pulling, true);
});

// test("_SIM test-program bool tags are exposed and round-trip", () => {
//   const e = new SimEngine(fastCfg);
//   // defaults are false
//   assert.equal(e.read(["opEnable", "estopLight"]).opEnable, false);
//   e.write({ opEnable: true, jogFwd: true, beaconRunningB: true });
//   const r = e.read(["opEnable", "jogFwd", "beaconRunningB", "jogRev"]);
//   assert.equal(r.opEnable, true);
//   assert.equal(r.jogFwd, true);
//   assert.equal(r.beaconRunningB, true);
//   assert.equal(r.jogRev, false);
// });
