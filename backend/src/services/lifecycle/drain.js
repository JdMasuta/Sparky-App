// Drain mode for the container update handover (#25). While draining, the
// backend refuses to START new checkouts but keeps serving everything else, so
// pulls already in progress can finish. The update supervisor then either
// commits (graceful shutdown) or resumes normal service.
//
// "Idle" means no checkout monitor long-polls are open AND the PLC handshake is
// back at step 1. If the PLC step can't be read (bridge/PLC down), no pull can
// be in progress at the cart, so only the monitor count decides.

export const DRAIN_MESSAGE =
  "Sparky is about to update. Please start your checkout again in a few minutes.";

/**
 * @param {object} opts
 * @param {() => number} opts.activeMonitors open checkout monitor sessions
 * @param {() => Promise<number|null>} opts.readStep current PLC stepNumber
 * @param {number} [opts.pollMs]
 */
export function createDrainController({ activeMonitors, readStep, pollMs = 1000 }) {
  let draining = false;
  let pending = null; // in-flight start() promise
  let cancel = null; // resolves the in-flight start() with "resumed"

  const sample = async () => {
    let step = null;
    try {
      const value = await readStep();
      step = value == null ? null : Number(value);
    } catch {
      step = null;
    }
    return { activeMonitors: activeMonitors(), step };
  };

  const isIdle = ({ activeMonitors: monitors, step }) =>
    monitors === 0 && (step === 1 || step === null);

  /** Rejects new checkout starts (the first checkout step, field "user"). */
  const middleware = (req, res, next) => {
    if (draining && req.method === "POST" && req.path === "/field" && req.body?.field === "user") {
      res.set("Retry-After", "300");
      return res.status(503).json({ error: DRAIN_MESSAGE, updating: true });
    }
    next();
  };

  /**
   * Enter drain mode and wait until idle or the deadline.
   * Resolves { result: "drained" | "timeout" | "resumed", activeMonitors, step }.
   * On "drained" the controller stays draining until resume() or shutdown.
   * On "timeout" it resumes normal service by itself.
   */
  const start = (deadlineMs) => {
    if (pending) return pending;
    draining = true;
    pending = new Promise((resolve) => {
      let stopped = false;
      cancel = async () => {
        stopped = true;
        resolve({ result: "resumed", ...(await sample()) });
      };
      const startedAt = Date.now();
      const loop = async () => {
        if (stopped) return;
        const state = await sample();
        if (stopped) return;
        if (isIdle(state)) {
          stopped = true;
          return resolve({ result: "drained", ...state });
        }
        if (Date.now() - startedAt >= deadlineMs) {
          stopped = true;
          draining = false;
          return resolve({ result: "timeout", ...state });
        }
        setTimeout(loop, pollMs);
      };
      loop();
    }).finally(() => {
      pending = null;
      cancel = null;
    });
    return pending;
  };

  /** Leave drain mode (also cancels an in-flight start()). */
  const resume = () => {
    draining = false;
    if (cancel) cancel();
  };

  return { middleware, start, resume, isDraining: () => draining };
}
