// Boot-time reconciliation (#25). Pure: given the persisted orchestrator state
// and the app containers Docker reports, decide how to get back to exactly one
// healthy active app container — e.g. after a KACE reboot in the middle of an
// update — and return the actions plus the corrected state. orchestrator.mjs
// executes the actions in order.
//
// Rules:
//   * before commit (preparing/standby/draining): the old container never
//     released the DB, so drop the standby container, keep/restart the old one
//     and requeue the update;
//   * after commit (committed/starting/verifying): the new container may have
//     touched the DB, so drop it, restore the pre-update snapshot (unless the
//     old container is still serving — the executor checks), restart the old
//     container and requeue;
//   * always: the active container exists, runs and restarts with Docker;
//     anything else labelled as a Sparky app is removed (code only, no state).

export const PRE_COMMIT = Object.freeze(["preparing", "standby", "draining"]);
export const POST_COMMIT = Object.freeze(["committed", "starting", "verifying"]);

/**
 * @param {object} input
 * @param {object} input.state persisted orchestrator state (not mutated)
 * @param {{name: string, running: boolean, image: string, created: number}[]} input.containers
 * @param {string} input.initialImage image to bootstrap from when nothing else is known
 * @param {number} input.now epoch ms
 * @returns {{ state: object, actions: object[] }}
 */
export function reconcile({ state, containers, initialImage, now }) {
  const s = structuredClone(state);
  const byName = new Map(containers.map((c) => [c.name, c]));
  const actions = [];
  const removed = new Set();
  const remove = (name) => {
    if (name && byName.has(name) && !removed.has(name)) {
      removed.add(name);
      actions.push({ type: "remove", name });
    }
  };
  const activeName = s.active?.name || null;
  const activeExists = !!activeName && byName.has(activeName);
  const u = s.update;

  if (u && PRE_COMMIT.includes(u.phase)) {
    remove(u.standbyName);
    if (u.phase === "draining" && activeExists) actions.push({ type: "resume", name: activeName });
    requeue(u, now, "Interrupted by a restart before the handover; requeued.");
  } else if (u && POST_COMMIT.includes(u.phase)) {
    remove(u.standbyName);
    if (s.active?.image) {
      // Executor: restore the snapshot and restart the old container, unless
      // it is already serving again.
      actions.push({ type: "rollbackDb", name: activeExists ? activeName : null, updateId: u.id, image: s.active.image });
    }
    requeue(u, now, "Interrupted during the handover; rolled back to the previous version and requeued.");
  }

  if (activeExists) {
    actions.push({ type: "setRestart", name: activeName, policy: "unless-stopped" });
    actions.push({ type: "ensureRunning", name: activeName });
    for (const c of containers) if (c.name !== activeName) remove(c.name);
  } else {
    // No usable active container: recreate it from the best-known image.
    let image = s.active?.image || null;
    if (!image) {
      const newest = containers
        .filter((c) => !removed.has(c.name))
        .sort((a, b) => Number(b.running) - Number(a.running) || b.created - a.created)[0];
      image = newest?.image || initialImage;
    }
    for (const c of containers) remove(c.name);
    if (!image) throw new Error("No active container and no image to bootstrap from (set SPARKY_APP_IMAGE)");
    actions.push({ type: "bootstrap", image, version: s.active?.version ?? null });
    s.active = null;
  }

  return { state: s, actions };
}

function requeue(u, now, reason) {
  u.phase = "queued";
  u.notBefore = new Date(now).toISOString();
  u.lastReason = reason;
  u.standbyName = null;
  u.handoverToken = null;
  u.cancelRequested = false;
}
