// Single source of truth for PLC tag aliases -> real ControlLogix addresses.
//
// Types are the logical CIP types; the real driver maps them to CIPDataType.
// Corrected from the legacy code: `quantity` is REAL (encoder counts exceed a
// SINT's 127 max) and `completeAck` is BOOL (was an invalid "?").
//
// IMPORTANT: tag names/types must be confirmed on-site against the live PLC
// program before running with PLC_MODE=real (see README real-PLC checklist).

/** @typedef {"REAL"|"DINT"|"SINT"|"INT"|"BOOL"|"STRING"} TagType */

export const TAGS = {
  quantity: { name: "Reel.RealData[0]", type: "REAL" },
  backupQuantity: { name: "Reel.RealData[10]", type: "REAL" },
  completeRequest: { name: "_200_GLB.BoolData[0].0", type: "BOOL" },
  userName: { name: "_200_GLB.StringData[0]", type: "STRING" },
  moNumber: { name: "_200_GLB.StringData[1]", type: "STRING" },
  itemNumber: { name: "_200_GLB.StringData[2]", type: "STRING" },
  completeAck: { name: "CompleteAck", type: "BOOL" },
  stepNumber: { name: "_200_GLB.DintData[2]", type: "DINT" },
  test: { name: "_200_GLB.Description", type: "STRING" },
  testWrite: { name: "_200_GLB.DintData[49]", type: "DINT" },
  testWrite2: { name: "_200_GLB.DintData[48]", type: "DINT" },

  // ---- _SIM test-program I/O (BOOL array on the test PLC) -----------------
  // Exposed for read/write via /api/plc/* diagnostics and the simulator store.
  // The first 32 bits are inputs, the last 32 are outputs — EXCEPT _SIM[8] and
  // _SIM[9] (Wired_FWD/Wired_REV) which are safety enables. (_SIM[4] and _SIM[6]
  // are unused placeholders on the test program and are intentionally omitted.)
  //
  // Operating protocol (documented here for future jog/interlock logic — NOT yet
  // implemented): OP_ENABLE must be set for every JOG_FWD / JOG_REV. ESTOP,
  // FLOOR_STOP_OP, FLOOR_STOP_NONOP, Motor_Disconnect_OK, Wired_FWD, and Wired_REV
  // must read TRUE; if any is false, write it true then toggle FAULT_RESET.
  //
  // Inputs (bits 0-31)
  opEnable: { name: "_SIM[0]", type: "BOOL" }, // OP_ENABLE
  jogFwd: { name: "_SIM[1]", type: "BOOL" }, // JOG_FWD
  jogRev: { name: "_SIM[2]", type: "BOOL" }, // JOG_REV
  estop: { name: "_SIM[3]", type: "BOOL" }, // ESTOP (must be true)
  faultReset: { name: "_SIM[5]", type: "BOOL" }, // FAULT_RESET
  countWheel: { name: "_SIM[7]", type: "BOOL" }, // Count_Wheel
  wiredFwd: { name: "_SIM[8]", type: "BOOL" }, // Wired_FWD (safety enable; must be true)
  wiredRev: { name: "_SIM[9]", type: "BOOL" }, // Wired_REV (safety enable; must be true)
  hmiEnter: { name: "_SIM[10]", type: "BOOL" }, // HMI_ENTER
  motorDisconnectOk: { name: "_SIM[11]", type: "BOOL" }, // Motor_Disconnect_OK (must be true)
  encoderCh1: { name: "_SIM[12]", type: "BOOL" }, // Encoder_CH1
  encoderCh2: { name: "_SIM[13]", type: "BOOL" }, // Encoder_CH2
  floorStopOp: { name: "_SIM[14]", type: "BOOL" }, // FLOOR_STOP_OP (must be true)
  floorStopNonop: { name: "_SIM[15]", type: "BOOL" }, // FLOOR_STOP_NONOP (must be true)
  // Outputs (bits 32+)
  estopLight: { name: "_SIM[32]", type: "BOOL" }, // ESTOP_LIGHT
  faultResetLight: { name: "_SIM[33]", type: "BOOL" }, // FAULT_RESET_LIGHT
  beaconRunningB: { name: "_SIM[34]", type: "BOOL" }, // BEACON_RUNNING_B
  beaconWarningY: { name: "_SIM[35]", type: "BOOL" }, // BEACON_WARNING_Y
  beaconAlarmR: { name: "_SIM[36]", type: "BOOL" }, // BEACON_ALARM_R
  beaconHorn: { name: "_SIM[37]", type: "BOOL" }, // BEACON_HORN
  hornStartBeep: { name: "_SIM[38]", type: "BOOL" }, // HORN_START_BEEP
};

export const isAlias = (alias) =>
  Object.prototype.hasOwnProperty.call(TAGS, alias);

/** Resolve an alias to its real PLC address; pass through unknown names so the
 * real driver can still read/write arbitrary tags for diagnostics. */
export const resolveName = (alias) => (isAlias(alias) ? TAGS[alias].name : alias);

/** Default zero value for a tag type (used to initialize the simulator store). */
export const defaultValue = (type) => {
  switch (type) {
    case "STRING":
      return "";
    case "BOOL":
      return false;
    default:
      return 0;
  }
};
