import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
} from "../src/services/auth/crypto.js";

// --- crypto units (no env needed) ------------------------------------------
test("hashPassword/verifyPassword round-trips and rejects wrong passwords", () => {
  const hash = hashPassword("s3cret!");
  assert.match(hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.ok(verifyPassword("s3cret!", hash));
  assert.ok(!verifyPassword("wrong", hash));
  assert.ok(!verifyPassword("s3cret!", "garbage"));
});

test("tokens verify when valid, and fail when tampered or expired", () => {
  const secret = "unit-secret";
  const token = createToken({ sub: "admin" }, secret, 10000);
  assert.equal(verifyToken(token, secret).sub, "admin");
  assert.equal(verifyToken(token + "x", secret), null); // tampered sig
  assert.equal(verifyToken(token, "other-secret"), null); // wrong secret
  const expired = createToken({ sub: "admin" }, secret, -1);
  assert.equal(verifyToken(expired, secret), null);
});

// --- HTTP login / session / CSRF flow --------------------------------------
// Set env BEFORE importing the config-dependent modules (dynamic import).
let server;
let base;

before(async () => {
  process.env.ADMIN_PASSWORD_HASH = hashPassword("letmein");
  process.env.SESSION_SECRET = "test-session-secret";
  const { default: authRoutes } = await import("../src/services/routes/authRoutes.js");
  const { requireAdmin } = await import("../src/services/middleware/requireAdmin.js");

  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.get("/protected", requireAdmin, (req, res) => res.json({ ok: true }));
  app.post("/protected", requireAdmin, (req, res) => res.json({ ok: true }));

  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server && server.close());

const jsonPost = (path, body, headers = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });

test("protected route requires a session", async () => {
  const res = await fetch(base + "/protected");
  assert.equal(res.status, 401);
});

test("login rejects wrong password, accepts correct and sets a cookie", async () => {
  assert.equal((await jsonPost("/api/auth/login", { password: "nope" })).status, 401);

  const res = await jsonPost("/api/auth/login", { password: "letmein" });
  assert.equal(res.status, 200);
  const cookie = res.headers.get("set-cookie");
  assert.match(cookie, /sparky_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
});

test("session cookie grants access; mutations still need the CSRF header", async () => {
  const login = await jsonPost("/api/auth/login", { password: "letmein" });
  const cookie = login.headers.get("set-cookie").split(";")[0];

  // GET with cookie -> ok
  const get = await fetch(base + "/protected", { headers: { Cookie: cookie } });
  assert.equal(get.status, 200);

  // POST with cookie but no CSRF header -> 403
  const noCsrf = await jsonPost("/protected", {}, { Cookie: cookie });
  assert.equal(noCsrf.status, 403);

  // POST with cookie + CSRF header -> ok
  const withCsrf = await jsonPost("/protected", {}, { Cookie: cookie, "X-Requested-By": "sparky" });
  assert.equal(withCsrf.status, 200);
});

test("GET /api/auth/session reflects auth state", async () => {
  const anon = await (await fetch(base + "/api/auth/session")).json();
  assert.equal(anon.authenticated, false);

  const login = await jsonPost("/api/auth/login", { password: "letmein" });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const authed = await (await fetch(base + "/api/auth/session", { headers: { Cookie: cookie } })).json();
  assert.equal(authed.authenticated, true);
});
