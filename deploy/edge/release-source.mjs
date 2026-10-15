// Where updates come from (#25). The orchestrator only ever deploys an image
// named by the release manifest of the pinned GitHub repo, from the pinned
// image repository, pinned by sha256 digest. Callers never supply an image
// reference (SECURITY.md trust boundaries 3 and 5).
//
// SPARKY_UPDATE_MANIFEST_URL (host config, edge.env) can point at an https:
// or file: manifest instead, for offline installs and device testing.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pickAssets } from "../updater.mjs";

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Split an image reference into repository, tag and digest.
 * "ghcr.io/o/app:1.2@sha256:ab.." -> { repo: "ghcr.io/o/app", tag: "1.2", digest: "sha256:ab.." }
 */
export function parseImageRef(ref) {
  let rest = String(ref || "");
  let digest = null;
  const at = rest.indexOf("@");
  if (at !== -1) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  let tag = null;
  const slash = rest.lastIndexOf("/");
  const colon = rest.lastIndexOf(":");
  if (colon > slash) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
  }
  return { repo: rest, tag, digest };
}

/**
 * Validate a release manifest against the pinned image repository.
 * @returns {{ version: string, image: string, repo: string, digest: string }}
 */
export function validateManifest(manifest, { imageRepo }) {
  if (!manifest || typeof manifest !== "object") throw new Error("Release manifest is not a JSON object");
  const version = String(manifest.version || "");
  if (!VERSION_RE.test(version)) throw new Error(`Release manifest has an invalid version "${version}"`);
  if (!manifest.image) throw new Error(`Release ${version} has no container image`);
  const { repo, digest } = parseImageRef(manifest.image);
  if (repo !== imageRepo) {
    throw new Error(`Release ${version} image repository "${repo}" is not the pinned "${imageRepo}"`);
  }
  if (!DIGEST_RE.test(digest || "")) throw new Error(`Release ${version} image is not pinned by sha256 digest`);
  if (manifest.imageDigest && manifest.imageDigest !== digest) {
    throw new Error(`Release ${version} imageDigest does not match its image reference`);
  }
  return { version, image: `${repo}@${digest}`, repo, digest };
}

async function getJson(fetchImpl, url, headers = {}) {
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "sparky-orchestrator", ...headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

/**
 * @param {object} o
 * @param {string} o.imageRepo     pinned image repository, e.g. ghcr.io/jdmasuta/sparky-app
 * @param {string} [o.releaseRepo] pinned GitHub repo, e.g. JdMasuta/Sparky-App
 * @param {string} [o.manifestUrl] https: or file: override
 * @param {typeof fetch} [o.fetchImpl]
 * @param {(path: string) => Promise<string|Buffer>} [o.readFileImpl]
 */
export function createReleaseSource({
  imageRepo,
  releaseRepo = "JdMasuta/Sparky-App",
  manifestUrl = "",
  fetchImpl = fetch,
  readFileImpl = (p) => readFile(p, "utf8"),
}) {
  if (!imageRepo) throw new Error("createReleaseSource: imageRepo is required");
  if (manifestUrl && !/^(https|file):/.test(manifestUrl)) {
    throw new Error("SPARKY_UPDATE_MANIFEST_URL must be an https: or file: URL");
  }

  async function loadManifest() {
    if (manifestUrl.startsWith("file:")) {
      return JSON.parse(String(await readFileImpl(fileURLToPath(manifestUrl))));
    }
    if (manifestUrl) return getJson(fetchImpl, manifestUrl);
    const release = await getJson(fetchImpl, `https://api.github.com/repos/${releaseRepo}/releases/latest`, {
      Accept: "application/vnd.github+json",
    });
    const { manifest } = pickAssets(release);
    if (!manifest) throw new Error(`Latest release ${release.tag_name || "?"} has no manifest.json`);
    return getJson(fetchImpl, manifest.browser_download_url);
  }

  return {
    /** The latest release's validated image. */
    async latest() {
      return validateManifest(await loadManifest(), { imageRepo });
    },
  };
}
