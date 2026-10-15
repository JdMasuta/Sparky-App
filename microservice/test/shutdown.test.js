import "./setup-env.js"; // must precede server.js — pins env before dotenv runs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, shutdown } from "../src/server.js";
import { SimDriver } from "../src/driver/simDriver.js";

function start(driver) {
  return new Promise((resolve) => {
    const server = createApp(driver).listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("shutdown closes the server and disconnects the PLC driver", async () => {
  const driver = new SimDriver({ simTickMs: 5 });
  await driver.connect();
  let disconnected = 0;
  const realDisconnect = driver.disconnect.bind(driver);
  driver.disconnect = async () => {
    disconnected++;
    return realDisconnect();
  };
  const server = await start(driver);
  let code;
  await shutdown(driver, server, { exit: (c) => (code = c), log: () => {} });
  assert.equal(disconnected, 1);
  assert.equal(code, 0);
  assert.equal(server.listening, false);
});

test("shutdown is idempotent per server", async () => {
  const driver = new SimDriver({ simTickMs: 5 });
  let disconnected = 0;
  driver.disconnect = async () => {
    disconnected++;
  };
  const server = await start(driver);
  let exits = 0;
  const opts = { exit: () => exits++, log: () => {} };
  await Promise.all([shutdown(driver, server, opts), shutdown(driver, server, opts)]);
  assert.equal(disconnected, 1);
  assert.equal(exits, 1);
});

test("a failing disconnect exits non-zero", async () => {
  const driver = new SimDriver({ simTickMs: 5 });
  driver.disconnect = async () => {
    throw new Error("socket gone");
  };
  const server = await start(driver);
  let code;
  await shutdown(driver, server, { exit: (c) => (code = c), log: () => {} });
  assert.equal(code, 1);
});
