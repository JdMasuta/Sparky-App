import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { parseVersion, isNewer, pickAssets, sha256File } from "../../deploy/updater.mjs";

test("parseVersion handles v-prefix and numeric parts", () => {
  assert.deepEqual(parseVersion("v3.1.2"), [3, 1, 2]);
  assert.deepEqual(parseVersion("3.0.0"), [3, 0, 0]);
});

test("isNewer compares versions correctly", () => {
  assert.ok(isNewer("3.1.0", "3.0.0"));
  assert.ok(isNewer("v3.0.1", "3.0.0"));
  assert.ok(isNewer("4.0.0", "3.9.9"));
  assert.ok(!isNewer("3.0.0", "3.0.0"));
  assert.ok(!isNewer("2.9.9", "3.0.0"));
});

test("pickAssets finds the zip and manifest from a release", () => {
  const release = {
    assets: [
      { name: "notes.txt" },
      { name: "sparky-app-3.1.0.zip", browser_download_url: "u1" },
      { name: "manifest.json", browser_download_url: "u2" },
    ],
  };
  const { zip, manifest } = pickAssets(release);
  assert.equal(zip.name, "sparky-app-3.1.0.zip");
  assert.equal(manifest.name, "manifest.json");
});

test("pickAssets returns undefined when assets are missing", () => {
  const { zip, manifest } = pickAssets({ assets: [] });
  assert.equal(zip, undefined);
  assert.equal(manifest, undefined);
});

test("sha256File hashes file contents", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "upd-test-"));
  const f = path.join(dir, "x.bin");
  await fs.writeFile(f, "hello");
  // sha256("hello")
  assert.equal(
    await sha256File(f),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
  );
});
