// Driver facade over the behavioral SimEngine. Exposes the PlcDriver contract
// plus the sim-only control surface (startPull/complete/reset/state) used by
// the /sim/* routes.
import { PlcDriver } from "./driver.js";
import { SimEngine } from "./simEngine.js";

export class SimDriver extends PlcDriver {
  constructor(config = {}) {
    super();
    this.engine = new SimEngine(config);
    this._connected = false;
  }

  async connect() {
    this._connected = true;
  }

  async disconnect() {
    this._connected = false;
    this.engine.reset();
  }

  get connected() {
    return this._connected;
  }

  get mode() {
    return "sim";
  }

  async read(aliases) {
    return this.engine.read(aliases);
  }

  async write(values) {
    return this.engine.write(values);
  }

  // sim-only control
  startPull(opts) {
    return this.engine.startPull(opts);
  }
  complete() {
    this.engine.complete();
  }
  resetSim() {
    this.engine.reset();
  }
  state() {
    return this.engine.state();
  }
}
