// PlcDriver — the seam that decouples the HTTP layer from how tags are actually
// read/written. Two implementations exist today (ethernetIpDriver, simDriver);
// a future protocol-level fake PLC could add a third without touching routes.
//
// All methods take/return tag ALIASES (see tags.js); each driver resolves them
// to real addresses. read() returns a plain object { alias: value }.

export class PlcDriver {
  /** Establish the connection (idempotent). */
  async connect() {
    throw new Error("not implemented");
  }

  /** Tear down the connection. */
  async disconnect() {}

  /** @returns {boolean} whether the driver is currently connected/ready. */
  get connected() {
    return false;
  }

  /** @returns {"real"|"sim"} */
  get mode() {
    return "unknown";
  }

  /**
   * @param {string[]} aliases
   * @returns {Promise<Record<string, any>>} map of alias -> value
   */
  async read(aliases) {
    throw new Error("not implemented");
  }

  /**
   * @param {Record<string, any>} values map of alias -> value to write
   * @returns {Promise<Record<string, "ok">>}
   */
  async write(values) {
    throw new Error("not implemented");
  }
}
