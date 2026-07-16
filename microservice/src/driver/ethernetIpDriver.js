// Live EtherNet/IP driver for Rockwell ControlLogix/CompactLogix via the
// `ethernet-ip` package (v2). Maintains ONE persistent, auto-reconnecting
// connection and a periodic heartbeat read (Logix drops idle sessions:
// ~30s CIP connection timeout, ~120s TCP inactivity timeout — without the
// heartbeat the log fills with ECONNRESET/reconnect cycles).
//
// Wire-format quirks this driver papers over (validated against ethernet-ip
// 2.0.0 internals):
//  - Custom string UDTs (STRING20 etc., anything but the built-in STRING
//    0x0FCE handle): the lib returns them as {LEN, DATA} structs and requires
//    the same shape (or a Buffer) on write — a bare JS string crashes with
//    "raw.copy is not a function". We convert string <-> {LEN, DATA} here.
//  - Multi-tag writes: the lib's writeBatch sizes bit-of-word masks from the
//    synthetic BOOL entry (1 byte) instead of the parent word type, so we
//    always write tags one at a time (writeSingle sizes masks correctly).
//  - A failed tag fails an entire multi-service read batch, so batch reads
//    fall back to per-tag reads (failed tags come back null).
import { PLC, STRING_STRUCT_HANDLE } from "ethernet-ip";
import { PlcDriver } from "./driver.js";
import { TAGS, isAlias, resolveName } from "../tags.js";

const NUMERIC_TYPES = new Set(["REAL", "DINT", "INT", "SINT"]);

/** Logix string struct ({LEN, DATA}) as decoded by the lib's template codec. */
const isLogixStringValue = (v) =>
  v !== null &&
  typeof v === "object" &&
  !Buffer.isBuffer(v) &&
  !Array.isArray(v) &&
  typeof v.LEN === "number" &&
  (Array.isArray(v.DATA) || Buffer.isBuffer(v.DATA));

const logixStringToJs = (v) => {
  const len = Math.max(0, Math.min(v.LEN, v.DATA.length));
  const bytes = Array.from(v.DATA.slice(0, len), (b) => b & 0xff);
  return Buffer.from(bytes).toString("latin1");
};

/** DATA holds SINTs, so bytes above 127 must wrap to the signed range. */
const jsToLogixString = (str, maxChars) => {
  const bytes = Buffer.from(String(str), "latin1").subarray(0, maxChars);
  return {
    LEN: bytes.length,
    DATA: Array.from(bytes, (b) => (b > 127 ? b - 256 : b)),
  };
};

export class EthernetIpDriver extends PlcDriver {
  constructor(config = {}) {
    super();
    this.config = config;
    this.plc = null;
    this._connecting = null;
    this._heartbeat = null;
    this._heartbeatBusy = false;
    this._heartbeatWarned = false;
  }

  async connect() {
    if (this.plc) {
      if (this.plc.isConnected) return;
      // The session exists and its auto-reconnect (infinite retries with
      // backoff) is working on it. Wait for it rather than leaking a second
      // connection — the old instance would keep reconnecting forever.
      return this._awaitReconnect();
    }
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
      this._startHeartbeat();
    })();

    try {
      await this._connecting;
    } finally {
      this._connecting = null;
    }
  }

  _awaitReconnect() {
    const plc = this.plc;
    const timeoutMs = this.config.connectTimeoutMs ?? 5000;
    return new Promise((resolve, reject) => {
      if (plc.isConnected) return resolve();
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("PLC is reconnecting; try again shortly"));
      }, timeoutMs);
      const onConnected = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timer);
        plc.off("connected", onConnected);
      };
      plc.on("connected", onConnected);
    });
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    const ms = this.config.plcHeartbeatMs ?? 15000;
    const tag = this.config.plcHeartbeatTag;
    if (!ms || ms <= 0 || !tag) return;
    this._heartbeat = setInterval(async () => {
      if (this._heartbeatBusy || !this.plc?.isConnected) return;
      this._heartbeatBusy = true;
      try {
        await this.plc.read(resolveName(tag));
      } catch (err) {
        // Even a CIP error response refreshes the PLC's inactivity timers, so
        // a bad heartbeat tag still keeps the session alive — warn only once.
        if (!this._heartbeatWarned) {
          this._heartbeatWarned = true;
          console.warn(`Heartbeat read of ${tag} failed: ${err.message}`);
        }
      } finally {
        this._heartbeatBusy = false;
      }
    }, ms);
    this._heartbeat.unref?.();
  }

  _stopHeartbeat() {
    if (this._heartbeat) {
      clearInterval(this._heartbeat);
      this._heartbeat = null;
    }
  }

  async disconnect() {
    this._stopHeartbeat();
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
    let arr;
    try {
      const values = await this.plc.read(names);
      arr = Array.isArray(values) ? values : [values];
    } catch (err) {
      if (names.length === 1) throw err;
      // One bad tag fails the whole multi-service batch; degrade to per-tag
      // reads so the rest of the poll still returns data.
      console.warn(`Batch read failed (${err.message}); retrying per-tag`);
      arr = [];
      for (const name of names) {
        try {
          arr.push(await this.plc.read(name));
        } catch (tagErr) {
          console.warn(`Read failed for ${name}: ${tagErr.message}`);
          arr.push(null);
        }
      }
    }
    const out = {};
    aliases.forEach((alias, i) => {
      const v = arr[i];
      out[alias] = isLogixStringValue(v) ? logixStringToJs(v) : v;
    });
    return out;
  }

  async write(values) {
    await this.connect();
    const out = {};
    for (const [alias, value] of Object.entries(values)) {
      const name = resolveName(alias);
      const wire = await this._toWireValue(alias, name, value);
      await this.plc.write(name, wire);
      out[alias] = "ok";
    }
    return out;
  }

  /** Coerce a JSON-transported value into what the lib can put on the wire. */
  async _toWireValue(alias, name, value) {
    let v = value;

    // Nudge primitives toward the declared type so a stray "42" or 1 doesn't
    // blow up in the codec layer (JSON clients aren't always well-typed).
    if (isAlias(alias)) {
      const type = TAGS[alias].type;
      if (type === "STRING" && typeof v !== "string") v = String(v ?? "");
      else if (type === "BOOL" && typeof v !== "boolean") v = Boolean(v);
      else if (NUMERIC_TYPES.has(type) && typeof v !== "number") {
        const n = Number(v);
        if (Number.isNaN(n)) {
          throw new Error(`value for ${alias} must be numeric, got ${JSON.stringify(value)}`);
        }
        v = n;
      }
    }

    // Custom string UDTs (STRING20 etc.) must be written as {LEN, DATA}; the
    // lib only accepts a bare JS string for the built-in STRING (0x0FCE).
    if (typeof v === "string") {
      let entry = this.plc.registry.lookup(name);
      if (!entry) {
        await this.plc.read(name); // priming read caches the tag's type
        entry = this.plc.registry.lookup(name);
      }
      if (entry?.isStruct && entry.type !== STRING_STRUCT_HANDLE) {
        const shape = this.plc.getShape(name);
        const maxChars = shape?.members?.DATA?.array;
        if (!maxChars) {
          throw new Error(
            `cannot encode string for ${name}: string template unknown (not a string tag?)`
          );
        }
        v = jsToLogixString(v, maxChars);
      }
    }
    return v;
  }
}
