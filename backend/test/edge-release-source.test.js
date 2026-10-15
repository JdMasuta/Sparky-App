import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseImageRef, validateManifest, createReleaseSource } from "../../deploy/edge/release-source.mjs";

const REPO = "ghcr.io/jdmasuta/sparky-app";
const DIGEST = "sha256:" + "b".repeat(64);
const manifest = (over = {}) => ({
  version: "3.7.0",
  asset: "sparky-app-3.7.0.zip",
  sha256: "c".repeat(64),
  image: `${REPO}@${DIGEST}`,
  imageDigest: DIGEST,
  imageTag: "3.7.0",
  ...over,
});

test("parseImageRef", () => {
  assert.deepEqual(parseImageRef(`${REPO}@${DIGEST}`), { repo: REPO, tag: null, digest: DIGEST });
  assert.deepEqual(parseImageRef(`${REPO}:3.7.0@${DIGEST}`), { repo: REPO, tag: "3.7.0", digest: DIGEST });
  assert.deepEqual(parseImageRef("localhost:5000/sparky-app:9.0.0"), {
    repo: "localhost:5000/sparky-app",
    tag: "9.0.0",
    digest: null,
  });
  assert.deepEqual(parseImageRef("sparky-app"), { repo: "sparky-app", tag: null, digest: null });
});

test("validateManifest accepts a digest-pinned image from the pinned repo", () => {
  assert.deepEqual(validateManifest(manifest(), { imageRepo: REPO }), {
    version: "3.7.0",
    image: `${REPO}@${DIGEST}`,
    repo: REPO,
    digest: DIGEST,
  });
  // A tag next to the digest is dropped; the digest is what runs.
  assert.equal(validateManifest(manifest({ image: `${REPO}:3.7.0@${DIGEST}` }), { imageRepo: REPO }).image, `${REPO}@${DIGEST}`);
});

test("validateManifest rejects anything not pinned to the expected image", () => {
  const cases = [
    [manifest({ image: undefined }), /no container image/],
    [manifest({ image: `ghcr.io/evil/sparky-app@${DIGEST}` }), /not the pinned/],
    [manifest({ image: `${REPO}:3.7.0` }), /not pinned by sha256 digest/],
    [manifest({ image: `${REPO}@sha256:abc` }), /not pinned by sha256 digest/],
    [manifest({ imageDigest: "sha256:" + "d".repeat(64) }), /does not match/],
    [manifest({ version: "v3.7.0" }), /invalid version/],
    [null, /not a JSON object/],
  ];
  for (const [m, re] of cases) assert.throws(() => validateManifest(m, { imageRepo: REPO }), re);
});

test("file: manifest override (offline installs, device tests)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-man-"));
  const file = path.join(dir, "manifest.json");
  await fs.writeFile(file, JSON.stringify(manifest({ version: "9.0.1" })));
  const source = createReleaseSource({ imageRepo: REPO, manifestUrl: pathToFileURL(file).href });
  assert.equal((await source.latest()).version, "9.0.1");
});

test("default source: GitHub latest release -> manifest.json asset", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, ua: opts.headers["User-Agent"] });
    if (url === "https://api.github.com/repos/JdMasuta/Sparky-App/releases/latest") {
      return Response.json({
        tag_name: "v3.7.0",
        assets: [
          { name: "sparky-app-3.7.0.zip", browser_download_url: "https://example/zip" },
          { name: "manifest.json", browser_download_url: "https://example/manifest.json" },
        ],
      });
    }
    if (url === "https://example/manifest.json") return Response.json(manifest());
    return new Response("nope", { status: 404 });
  };
  const source = createReleaseSource({ imageRepo: REPO, fetchImpl });
  assert.equal((await source.latest()).digest, DIGEST);
  assert.deepEqual(calls.map((c) => c.url), [
    "https://api.github.com/repos/JdMasuta/Sparky-App/releases/latest",
    "https://example/manifest.json",
  ]);
  assert.ok(calls.every((c) => c.ua === "sparky-orchestrator"));
});

test("GitHub errors and missing manifests surface clearly", async () => {
  const noManifest = createReleaseSource({
    imageRepo: REPO,
    fetchImpl: async () => Response.json({ tag_name: "v3.7.0", assets: [] }),
  });
  await assert.rejects(noManifest.latest(), /has no manifest.json/);
  const down = createReleaseSource({ imageRepo: REPO, fetchImpl: async () => new Response("x", { status: 503 }) });
  await assert.rejects(down.latest(), /HTTP 503/);
});

test("only https: and file: overrides are allowed", () => {
  assert.throws(() => createReleaseSource({ imageRepo: REPO, manifestUrl: "http://lan/manifest.json" }), /https: or file:/);
  assert.throws(() => createReleaseSource({ imageRepo: "" }), /imageRepo/);
});
