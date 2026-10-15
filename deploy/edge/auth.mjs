// Orchestrator <-> app authentication (#25, SECURITY.md trust boundary 3).
//
// Each app container gets its own token, derived from the orchestrator's
// secret and the container's unique name: HMAC-SHA256(secret, name). The
// orchestrator keeps only the secret, can recompute any container's token to
// call that container's handover API, and accepts control-API calls only with
// the token of the currently ACTIVE container. Container names are never
// reused, so removing a container revokes its token.
import { createHmac, randomBytes } from "node:crypto";
import { bearerMatches } from "../container/handover.mjs";

/** New 256-bit orchestrator secret (hex). */
export const newSecret = () => randomBytes(32).toString("hex");

/** Random hex token, e.g. a per-update handover token. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("hex");

/** The control token for the app container named `name`. */
export function tokenFor(secret, name) {
  if (!secret || !name) throw new Error("tokenFor needs a secret and a container name");
  return createHmac("sha256", secret).update(`sparky-app:${name}`).digest("hex");
}

/** True when the Authorization header carries the active container's token. */
export function authorize(header, { secret, active }) {
  if (!secret || !active) return false;
  return bearerMatches(header, tokenFor(secret, active));
}
