// Minimal Docker Engine API client over the unix socket (#25), with no
// dependencies. Deliberately narrow: images, containers and network attach
// only. There are NO volume or exec calls, so the orchestrator cannot delete
// the data volume or run commands inside containers (SECURITY.md).
import http from "node:http";

export class DockerError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Demultiplex a non-TTY log stream into text. Each frame has an 8-byte header:
 * stream type (0/1/2), three zero bytes, then a big-endian payload size.
 * Anything that doesn't parse as frames (a TTY container) is returned as-is.
 */
export function demuxLogs(buf) {
  let out = "";
  let i = 0;
  while (i < buf.length) {
    const validHeader =
      i + 8 <= buf.length && buf[i] <= 2 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 0;
    const size = validHeader ? buf.readUInt32BE(i + 4) : -1;
    if (!validHeader || i + 8 + size > buf.length) return buf.toString("utf8");
    out += buf.subarray(i + 8, i + 8 + size).toString("utf8");
    i += 8 + size;
  }
  return out;
}

/** Find an error in a JSON-lines progress stream (pull reports errors inline). */
export function streamError(text) {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.error || msg.errorDetail) return msg.error || msg.errorDetail.message || "unknown error";
    } catch {
      /* ignore partial or non-JSON lines */
    }
  }
  return null;
}

const enc = encodeURIComponent;

/**
 * @param {object} [opts]
 * @param {string} [opts.socketPath]
 * @param {number} [opts.timeoutMs] default per-request timeout
 */
export function createDockerClient({ socketPath = "/var/run/docker.sock", timeoutMs = 30_000 } = {}) {
  let prefix = null; // "/v1.xx", negotiated on first use

  function raw(method, path, { body, timeout = timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = http.request(
        {
          socketPath,
          method,
          path,
          headers: payload
            ? { "Content-Type": "application/json", "Content-Length": payload.length }
            : {},
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
          res.on("error", reject);
        },
      );
      req.setTimeout(timeout, () => req.destroy(new Error(`Docker API ${method} ${path} timed out`)));
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  async function api(method, path, opts = {}) {
    if (!prefix) {
      const res = await raw("GET", "/version");
      if (res.status !== 200) throw new DockerError(res.status, "Docker API /version failed");
      prefix = `/v${JSON.parse(res.body.toString("utf8")).ApiVersion}`;
    }
    const res = await raw(method, prefix + path, opts);
    if (res.status >= 400 && !(opts.allow || []).includes(res.status)) {
      let message = res.body.toString("utf8");
      try {
        message = JSON.parse(message).message || message;
      } catch {
        /* plain-text error */
      }
      throw new DockerError(res.status, `Docker API ${method} ${path}: ${res.status} ${message}`.trim());
    }
    return res;
  }

  const json = (res) => (res.body.length ? JSON.parse(res.body.toString("utf8")) : null);

  return {
    async version() {
      return json(await api("GET", "/version"));
    },

    /** Image details, or null when the image is not present. */
    async imageInspect(ref) {
      const res = await api("GET", `/images/${enc(ref)}/json`, { allow: [404] });
      return res.status === 404 ? null : json(res);
    },

    /** Pull `repo[:tag|@digest]`; rejects on errors reported inside the stream. */
    async imagePull(ref, { timeout = 30 * 60_000 } = {}) {
      const at = ref.indexOf("@");
      const slash = ref.lastIndexOf("/");
      const colon = ref.lastIndexOf(":");
      let repo = ref;
      let tag = "latest";
      if (at !== -1) {
        repo = ref.slice(0, at);
        tag = ref.slice(at + 1);
      } else if (colon > slash) {
        repo = ref.slice(0, colon);
        tag = ref.slice(colon + 1);
      }
      const res = await api("POST", `/images/create?fromImage=${enc(repo)}&tag=${enc(tag)}`, { timeout });
      const error = streamError(res.body.toString("utf8"));
      if (error) throw new DockerError(500, `Pull of ${ref} failed: ${error}`);
    },

    /** Remove an image; false when it is missing or still in use. */
    async imageRemove(ref) {
      const res = await api("DELETE", `/images/${enc(ref)}`, { allow: [404, 409] });
      return res.status < 400;
    },

    /** @returns {Promise<string>} container id */
    async containerCreate(name, body) {
      return json(await api("POST", `/containers/create?name=${enc(name)}`, { body })).Id;
    },

    async networkConnect(network, container) {
      await api("POST", `/networks/${enc(network)}/connect`, { body: { Container: container } });
    },

    async containerStart(id) {
      await api("POST", `/containers/${enc(id)}/start`, { allow: [304] });
    },

    async containerStop(id, seconds = 30) {
      await api("POST", `/containers/${enc(id)}/stop?t=${seconds}`, {
        allow: [304, 404],
        timeout: (seconds + 15) * 1000,
      });
    },

    async containerRestart(id, seconds = 30) {
      await api("POST", `/containers/${enc(id)}/restart?t=${seconds}`, { timeout: (seconds + 30) * 1000 });
    },

    async containerUpdate(id, update) {
      await api("POST", `/containers/${enc(id)}/update`, { body: update });
    },

    /** Remove a container (never its volumes); false when it does not exist. */
    async containerRemove(id, { force = true } = {}) {
      const res = await api("DELETE", `/containers/${enc(id)}?force=${force ? 1 : 0}`, { allow: [404] });
      return res.status !== 404;
    },

    /** Container details, or null when it does not exist. */
    async containerInspect(id) {
      const res = await api("GET", `/containers/${enc(id)}/json`, { allow: [404] });
      return res.status === 404 ? null : json(res);
    },

    /** All containers (running or not) carrying every `key=value` label given. */
    async containerList({ labels = [] } = {}) {
      const filters = enc(JSON.stringify({ label: labels }));
      return json(await api("GET", `/containers/json?all=1&filters=${filters}`));
    },

    async containerLogs(id, tail = 200) {
      const res = await api("GET", `/containers/${enc(id)}/logs?stdout=1&stderr=1&tail=${tail}`, {
        allow: [404],
      });
      return res.status === 404 ? "" : demuxLogs(res.body);
    },

    /** Wait for a container to stop; resolves its exit code. */
    async containerWait(id, { timeout = 10 * 60_000 } = {}) {
      return json(await api("POST", `/containers/${enc(id)}/wait`, { timeout })).StatusCode;
    },
  };
}
