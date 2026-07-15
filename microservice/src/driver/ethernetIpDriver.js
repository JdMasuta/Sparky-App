// Live EtherNet/IP driver for Rockwell ControlLogix/CompactLogix via the
// `ethernet-ip` package (v2). Maintains ONE persistent, auto-reconnecting
// connection (the legacy code opened a fresh socket per read/write/poll, which
// churned connections badly). Tag types are learned via discovery on connect.
//
// NOTE: this path cannot be exercised without the physical PLC. It is written
// to the documented v2 API; validate on-site (README real-PLC checklist) before
// relying on it. Development, tests, and CI use the simulator (PLC_MODE=sim).
import { PLC } from "ethernet-ip";
import { PlcDriver } from "./driver.js";
import { resolveName } from "../tags.js";

export class EthernetIpDriver extends PlcDriver {
  constructor(config = {}) {
    super();
    this.config = config;
    this.plc = null;
    this._connecting = null;
  }

  async connect() {
    if (this.plc && this.plc.isConnected) return;
    if (this._connecting) return this._connecting;

    this._connecting = (async () => {
      const plc = new PLC();
      plc.on("error", (err) => console.error("PLC error:", err.message));
      plc.on("disconnected", () => console.warn("PLC disconnected"));
      plc.on("reconnecting", (n) => console.warn(`PLC reconnecting (attempt ${n})`));
      plc.on("connected", () => console.log("PLC connected"));

      await plc.connect(this.config.plcIp, {
        slot: this.config.plcSlot ?? 0,
        timeout: this.config.connectTimeoutMs ?? 5000,
        discover: true, // populate the tag registry so read/write know types
        autoReconnect: true,
      });
      this.plc = plc;
    })();

    try {
      await this._connecting;
    } finally {
      this._connecting = null;
    }
  }

  async disconnect() {
    if (this.plc) {
      try {
        await this.plc.disconnect();
      } catch {
        /* ignore */
      }
      this.plc = null;
    }
  }

  get connected() {
    return !!(this.plc && this.plc.isConnected);
  }

  get mode() {
    return "real";
  }

  async read(aliases) {
    await this.connect();
    const names = aliases.map(resolveName);
    const values = await this.plc.read(names);
    const arr = Array.isArray(values) ? values : [values];
    const out = {};
    aliases.forEach((alias, i) => {
      out[alias] = arr[i];
    });
    return out;
  }

  async write(values) {
    await this.connect();
    const record = {};
    for (const [alias, value] of Object.entries(values)) {
      record[resolveName(alias)] = value;
    }
    await this.plc.write(record);
    const out = {};
    for (const alias of Object.keys(values)) out[alias] = "ok";
    return out;
  }
}
