import "./setup-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../src/config.js";

test("real mode without PLC_IP fails fast", () => {
  assert.throws(() => validateConfig({ mode: "real", plcIp: "" }), /PLC_IP is not set/);
});

test("real mode with PLC_IP is valid", () => {
  const cfg = { mode: "real", plcIp: "10.0.0.5" };
  assert.equal(validateConfig(cfg), cfg);
});

test("sim mode needs no PLC_IP", () => {
  assert.doesNotThrow(() => validateConfig({ mode: "sim", plcIp: "" }));
});
