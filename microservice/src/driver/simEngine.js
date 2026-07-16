// Behavioral "virtual Sparky PLC".
//
// Models the parts of the real PLC program the web app interacts with: an
// in-memory tag store, the step-number handshake the Checkout page drives, and
// an encoder that ramps `quantity` during an active pull and raises
// `completeRequest` when the target is reached.
//
// On the real machine the motor is started at the physical HMI, so the sim has
// an explicit start trigger (startPull) rather than starting a pull on its own
// — unless SIM_AUTO_PULL is enabled, which auto-starts shortly after the
// operator finishes entering fields (step 4), for hands-free demos.
import { TAGS, defaultValue } from "../tags.js";

export class SimEngine {
  constructor(config = {}) {
    this.config = {
      autoPull: config.simAutoPull ?? false,
      autoPullDelayMs: config.simAutoPullDelayMs ?? 2000,
      defaultTarget: config.simDefaultTarget ?? 100,
      defaultRate: config.simDefaultRate ?? 10,
      tickMs: config.simTickMs ?? 100,
    };
    this.store = {};
    this._timer = null;
    this._autoTimer = null;
    this.pull = null; // { target, rate }
    this.reset();
  }

  /** Initialize/clear all tags to their type default. */
  reset() {
    this._stopTicker();
    this._clearAutoTimer();
    this.store = {};
    for (const [alias, def] of Object.entries(TAGS)) {
      this.store[alias] = defaultValue(def.type);
    }
    this.store.stepNumber = 1; // 1 = idle
    this.pull = null;
  }

  read(aliases) {
    const out = {};
    for (const a of aliases) out[a] = this.store[a];
    return out;
  }

  write(values) {
    const out = {};
    for (const [alias, value] of Object.entries(values)) {
      this._applyWrite(alias, value);
      out[alias] = "ok";
    }
    return out;
  }

  _applyWrite(alias, value) {
    // Writing stepNumber = 1 is the cycle reset the Checkout page issues.
    if (alias === "stepNumber") {
      const step = Number(value);
      this.store.stepNumber = step;
      if (step === 1) {
        this._resetCycle();
      } else if (step >= 4 && this.config.autoPull) {
        this._scheduleAutoPull();
      }
      return;
    }
    this.store[alias] = value;
  }

  /** Clear the pull-related tags without wiping the whole store. */
  _resetCycle() {
    this._stopTicker();
    this._clearAutoTimer();
    this.pull = null;
    this.store.userName = "";
    this.store.moNumber = "";
    this.store.itemNumber = "";
    this.store.quantity = 0;
    this.store.backupQuantity = 0;
    this.store.completeRequest = false;
    this.store.completeAck = false;
  }

  /**
   * Start (or restart) a pull: the encoder ramps `quantity` by `rate` every
   * tick until it reaches `target`, then raises completeRequest.
   */
  startPull({ targetQuantity, rate } = {}) {
    const target = Number(targetQuantity ?? this.config.defaultTarget);
    const step = Number(rate ?? this.config.defaultRate);
    if (!(target > 0) || !(step > 0)) {
      throw new Error("targetQuantity and rate must be positive numbers");
    }
    this._clearAutoTimer();
    this.pull = { target, rate: step };
    this.store.quantity = 0;
    this.store.backupQuantity = 0;
    this.store.completeRequest = false;
    this.store.completeAck = false;
    this._startTicker();
    return { target, rate: step };
  }

  /** Immediately finish the active (or a default) pull. */
  complete() {
    this._stopTicker();
    if (!this.pull) this.pull = { target: this.store.quantity || this.config.defaultTarget, rate: this.config.defaultRate };
    this.store.quantity = this.pull.target;
    this.store.backupQuantity = this.pull.target;
    this.store.completeRequest = true;
  }

  state() {
    return {
      mode: "sim",
      step: this.store.stepNumber,
      pulling: this._timer !== null,
      pull: this.pull,
      tags: { ...this.store },
    };
  }

  // --- internals ---
  _tick() {
    if (!this.pull) return;
    const next = Math.min(this.store.quantity + this.pull.rate, this.pull.target);
    this.store.quantity = next;
    this.store.backupQuantity = next;
    if (next >= this.pull.target) {
      this.store.completeRequest = true;
      this._stopTicker();
    }
  }

  _startTicker() {
    this._stopTicker();
    this._timer = setInterval(() => this._tick(), this.config.tickMs);
    if (this._timer.unref) this._timer.unref();
  }

  _stopTicker() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _scheduleAutoPull() {
    this._clearAutoTimer();
    this._autoTimer = setTimeout(
      () => this.startPull({}),
      this.config.autoPullDelayMs
    );
    if (this._autoTimer.unref) this._autoTimer.unref();
  }

  _clearAutoTimer() {
    if (this._autoTimer) {
      clearTimeout(this._autoTimer);
      this._autoTimer = null;
    }
  }
}
