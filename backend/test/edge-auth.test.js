import { test } from "node:test";
import assert from "node:assert/strict";
import { newSecret, randomToken, tokenFor, authorize } from "../../deploy/edge/auth.mjs";

test("secrets and tokens are random hex of the requested size", () => {
  assert.match(newSecret(), /^[0-9a-f]{64}$/);
  assert.match(randomToken(3), /^[0-9a-f]{6}$/);
  assert.notEqual(newSecret(), newSecret());
});

test("tokens are per container and per secret", () => {
  const s = newSecret();
  assert.equal(tokenFor(s, "a"), tokenFor(s, "a"));
  assert.notEqual(tokenFor(s, "a"), tokenFor(s, "b"));
  assert.notEqual(tokenFor(s, "a"), tokenFor(newSecret(), "a"));
  assert.throws(() => tokenFor("", "a"));
  assert.throws(() => tokenFor(s, ""));
});

test("only the active container's token is accepted", () => {
  const secret = newSecret();
  const active = "sparky-app-3.7.0-aaaaaa";
  const old = "sparky-app-3.6.0-bbbbbb";
  assert.equal(authorize(`Bearer ${tokenFor(secret, active)}`, { secret, active }), true);
  assert.equal(authorize(`Bearer ${tokenFor(secret, old)}`, { secret, active }), false, "removed/old container");
  assert.equal(authorize(tokenFor(secret, active), { secret, active }), false, "missing Bearer scheme");
  assert.equal(authorize(undefined, { secret, active }), false);
  assert.equal(authorize(`Bearer ${tokenFor(secret, active)}`, { secret, active: null }), false);
  assert.equal(authorize(`Bearer x`, { secret: null, active }), false);
});
