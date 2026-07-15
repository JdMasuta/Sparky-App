// PLC bridge configuration (all via environment).
export const config = {
  // "sim"  -> behavioral virtual PLC (no hardware; dev/CI/commissioning)
  // "real" -> live EtherNet/IP connection to the ControlLogix PLC
  mode: (process.env.PLC_MODE || "sim").toLowerCase(),

  // The bridge binds to loopback by default so it is NOT reachable from the
  // LAN. The backend (same host) is its only client.
  host: process.env.BRIDGE_HOST || "127.0.0.1",
  port: Number(process.env.BRIDGE_PORT || process.env.PORT || 8000),

  // Shared secret required on every request (defense-in-depth atop the loopback
  // bind). Empty string disables the check (dev convenience).
  token: process.env.BRIDGE_TOKEN || "",

  // Real driver
  plcIp: process.env.PLC_IP || "192.168.1.70",
  plcSlot: Number(process.env.PLC_SLOT || 0),
  connectTimeoutMs: Number(process.env.PLC_TIMEOUT_MS || 5000),

  // Simulator
  simAutoPull: /^(1|true|yes)$/i.test(process.env.SIM_AUTO_PULL || ""),
  simAutoPullDelayMs: Number(process.env.SIM_AUTO_PULL_DELAY_MS || 2000),
  simDefaultTarget: Number(process.env.SIM_DEFAULT_TARGET || 100),
  simDefaultRate: Number(process.env.SIM_DEFAULT_RATE || 10),
  simTickMs: Number(process.env.SIM_TICK_MS || 100),
};

export const isSim = () => config.mode === "sim";
