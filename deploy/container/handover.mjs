// Pure pieces of the update handover (protocol v1, issue #25): the app
// container's phase machine, message validation, and bind-address selection.
// No I/O here — entrypoint.mjs does the I/O and is tested through these.
//
// Compatibility rule: the OLD container runs the older code's release logic, so
// protocol v1 may only gain fields. A container accepts any protocol <= its own.
import { timingSafeEqual } from "node:crypto";
import path from "node:path";

export const PROTOCOL = 1;

// phase -> { event: nextPhase }
const TRANSITIONS = {
  preflight: { "preflight-ok": "standby-ready", "preflight-fail": "preflight-failed" },
  "standby-ready": { ack: "starting" },
  starting: { started: "active", "start-fail": "start-failed" },
  active: { release: "draining" },
  draining: { drained: "drained", "drain-timeout": "active", resume: "active" },
  drained: { commit: "stopping", resume: "active" },
  stopping: { released: "released", "ack-failed": "starting" },
  "preflight-failed": {},
  "start-failed": {},
  released: {},
};

export const PHASES = Object.keys(TRANSITIONS);

/** Next phase for `event`, or throws (callers map that to HTTP 409). */
export function transition(phase, event) {
  const next = TRANSITIONS[phase]?.[event];
  if (!next) {
    const err = new Error(`Event "${event}" is not allowed in phase "${phase}"`);
    err.status = 409;
    throw err;
  }
  return next;
}

/** Initial phase: standby containers wait for a handshake; others start at once. */
export const initialPhase = (standby) => (standby ? "preflight" : "starting");

export const acceptsProtocol = (p) => Number.isInteger(p) && p >= 1 && p <= PROTOCOL;

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const ID_RE = /^[a-zA-Z0-9-]{1,64}$/;

/** Constant-time string comparison; false for empty/missing values. */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** True when an Authorization header carries `Bearer <token>`. */
export function bearerMatches(header, token) {
  const m = /^Bearer (.+)$/.exec(header || "");
  return !!m && safeEqual(m[1], token);
}

const fail = (status, error) => ({ ok: false, status, error });

/** Validate the orchestrator's release request (sent to the OLD container). */
export function validateRelease(body) {
  if (!body || typeof body !== "object") return fail(400, "JSON body required");
  if (!acceptsProtocol(body.protocol)) return fail(400, `Unsupported protocol ${body.protocol}`);
  if (!ID_RE.test(body.updateId || "")) return fail(400, "Invalid updateId");
  if (typeof body.updateToken !== "string" || body.updateToken.length < 32)
    return fail(400, "Invalid updateToken");
  if (!NAME_RE.test(body.successor || "")) return fail(400, "Invalid successor");
  const drainTimeoutMs = Number(body.drainTimeoutMs);
  if (!Number.isFinite(drainTimeoutMs) || drainTimeoutMs < 0 || drainTimeoutMs > 3_600_000)
    return fail(400, "Invalid drainTimeoutMs");
  return {
    ok: true,
    value: {
      updateId: body.updateId,
      updateToken: body.updateToken,
      successor: body.successor,
      drainTimeoutMs,
    },
  };
}

/** Validate the predecessor's ack (received by the NEW container). */
export function validateAck(body, { expectedToken, predecessor }) {
  if (!body || typeof body !== "object") return fail(400, "JSON body required");
  if (!acceptsProtocol(body.protocol)) return fail(400, `Unsupported protocol ${body.protocol}`);
  if (!safeEqual(body.token, expectedToken)) return fail(403, "Invalid handover token");
  if (!predecessor || body.from?.name !== predecessor)
    return fail(403, "Ack is not from the expected predecessor");
  return {
    ok: true,
    value: {
      updateId: body.updateId,
      from: { name: body.from.name, version: body.from.version },
      snapshot: body.snapshot ?? null,
      cleanShutdown: body.cleanShutdown === true,
    },
  };
}

/** Build the ack the OLD container sends to its successor. */
export function buildAck({ updateId, updateToken, name, version, snapshot, cleanShutdown }) {
  return {
    protocol: PROTOCOL,
    updateId,
    token: updateToken,
    from: { name, version },
    snapshot,
    cleanShutdown,
  };
}

/**
 * Hostname of an app container on the control network. App containers sit on
 * several networks and Docker's DNS may answer a bare container name with an
 * address on any of them, but the handover listener binds to the control
 * address only. The orchestrator registers this alias on the control network
 * alone, so it always resolves to the right address.
 */
export const controlHostname = (name) => `${name}-control`;

/**
 * Marker written (in the data volume) when a standby-created container accepts
 * its predecessor's ack. A container's env never changes, so a promoted
 * container still says SPARKY_STANDBY=1; on every later boot (Docker restart,
 * reboot, rollback) the marker makes it start active instead of waiting for a
 * handshake that will never come.
 */
export const promotedMarker = (dataDir, name) => path.join(dataDir, ".sparky", "promoted", name);

/** Standby boot only for a standby-created container that was never promoted. */
export const bootsInStandby = (standbyEnv, promoted) => !!standbyEnv && !promoted;

/** Snapshot path for an update; updateId is validated, so it is path-safe. */
export const snapshotName = (updateId) => `pre-${updateId}.sqlite`;

const ipToInt = (ip) =>
  ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;

/** IPv4 CIDR membership, e.g. ipInSubnet("172.30.1.5", "172.30.1.0/24"). */
export function ipInSubnet(ip, cidr) {
  const [base, bitsRaw] = String(cidr).split("/");
  const bits = Number(bitsRaw);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(base)) return false;
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(base) & mask);
}

/**
 * Address for the handover listener: the container's IP on the control subnet,
 * so the LAN-facing network can't reach it. Without a subnet (standalone run),
 * loopback. Throws if a subnet is configured but no interface matches.
 * @param {ReturnType<typeof import("node:os").networkInterfaces>} interfaces
 */
export function pickBindAddress(interfaces, subnet) {
  if (!subnet) return "127.0.0.1";
  for (const addrs of Object.values(interfaces)) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal && ipInSubnet(a.address, subnet)) return a.address;
    }
  }
  throw new Error(`No network interface in control subnet ${subnet}`);
}
