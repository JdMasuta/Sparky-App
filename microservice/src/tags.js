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
  // ADDRESSING: Logix exposes BOOL arrays over CIP as DWORD arrays (BOOL[64] =
  // 2 DWORDs), so bit i must be addressed as `_SIM[i>>5].{i&31}` (bit-of-word).
  // Reads decode the word and extract the bit; writes use CIP Read-Modify-Write
  // with a single-bit mask. Addressing `_SIM[i]` directly either hits the wrong
  // DWORD element (i<2) or fails with "Path segment error" (i>=2).
  //
  // Operating protocol (documented here for future jog/interlock logic — NOT yet
  // implemented): OP_ENABLE must be set for every JOG_FWD / JOG_REV. ESTOP,
  // FLOOR_STOP_OP, FLOOR_STOP_NONOP, Motor_Disconnect_OK, Wired_FWD, and Wired_REV
  // must read TRUE; if any is false, write it true then toggle FAULT_RESET.
  //
  // Inputs (bits 0-31)
  opEnable: { name: "_SIM[0].0", type: "BOOL" }, // OP_ENABLE (bit 0)
  jogFwd: { name: "_SIM[0].1", type: "BOOL" }, // JOG_FWD (bit 1)
  jogRev: { name: "_SIM[0].2", type: "BOOL" }, // JOG_REV (bit 2)
  estop: { name: "_SIM[0].3", type: "BOOL" }, // ESTOP (bit 3; must be true)
  faultReset: { name: "_SIM[0].5", type: "BOOL" }, // FAULT_RESET (bit 5)
  countWheel: { name: "_SIM[0].7", type: "BOOL" }, // Count_Wheel (bit 7)
  wiredFwd: { name: "_SIM[0].8", type: "BOOL" }, // Wired_FWD (bit 8; safety enable; must be true)
  wiredRev: { name: "_SIM[0].9", type: "BOOL" }, // Wired_REV (bit 9; safety enable; must be true)
  hmiEnter: { name: "_SIM[0].10", type: "BOOL" }, // HMI_ENTER (bit 10)
  motorDisconnectOk: { name: "_SIM[0].11", type: "BOOL" }, // Motor_Disconnect_OK (bit 11; must be true)
  encoderCh1: { name: "_SIM[0].12", type: "BOOL" }, // Encoder_CH1 (bit 12)
  encoderCh2: { name: "_SIM[0].13", type: "BOOL" }, // Encoder_CH2 (bit 13)
  floorStopOp: { name: "_SIM[0].14", type: "BOOL" }, // FLOOR_STOP_OP (bit 14; must be true)
  floorStopNonop: { name: "_SIM[0].15", type: "BOOL" }, // FLOOR_STOP_NONOP (bit 15; must be true)
  // Outputs (bits 32+ = DWORD element 1)
  estopLight: { name: "_SIM[1].0", type: "BOOL" }, // ESTOP_LIGHT (bit 32)
  faultResetLight: { name: "_SIM[1].1", type: "BOOL" }, // FAULT_RESET_LIGHT (bit 33)
  beaconRunningB: { name: "_SIM[1].2", type: "BOOL" }, // BEACON_RUNNING_B (bit 34)
  beaconWarningY: { name: "_SIM[1].3", type: "BOOL" }, // BEACON_WARNING_Y (bit 35)
  beaconAlarmR: { name: "_SIM[1].4", type: "BOOL" }, // BEACON_ALARM_R (bit 36)
  beaconHorn: { name: "_SIM[1].5", type: "BOOL" }, // BEACON_HORN (bit 37)
  hornStartBeep: { name: "_SIM[1].6", type: "BOOL" }, // HORN_STARTBEEP (bit 38)

  // Aliased IO
  // Inputs (I1000):
  SSW_OPCON_SSW_JOG_FORWARD: { name: "I1000.0", type: "BOOL" },
  SSW_OPCON_SSW_JOG_REVERSE: { name: "I1000.1", type: "BOOL" },
  PB_OPCON_FAULT_RESET_PB: { name: "I1000.2", type: "BOOL" },
  E_STOP_OPCON_E_STOP: { name: "I1000.3", type: "BOOL" },
  PB_OPCON_OP_ENABLE_PB: { name: "I1000.4", type: "BOOL" },
  DSK_PULLER_MOTOR_DISCONNECT_0K: { name: "I1000.5", type: "BOOL" },
  PE_PULLER_COUNT_WHEEL: { name: "I1000.6", type: "BOOL" },
  PE_PULLER: { name: "I1000.7", type: "BOOL" },
  PRX_SAFETY_FLOOR_STOP_NON_OPERATOR_SIDE: { name: "I1000.8", type: "BOOL" },
  PRX_SAFETY_FLOOR_STOP_OPERATOR_SIDE: { name: "I1000.9", type: "BOOL" },
  // Outputs (O1000):
  E_STOP_PB_LIGHT: { name: "O1000.0", type: "BOOL" },
  FAULT_RESET_PB_LIGHT: { name: "O1000.1", type: "BOOL" },
  BEACON_STACK_BLUE_RUNNING: { name: "O1000.2", type: "BOOL" },
  BEACON_STACK_YELLOW_WARNING: { name: "O1000.3", type: "BOOL" },
  BEACON_STACK_RED_ALARM: { name: "O1000.4", type: "BOOL" },
  BEACON_STACK_HORN_SOUNDER: { name: "O1000.5", type: "BOOL" },
  Wired_FWD: { name: "O1000.7", type: "BOOL" },
  Wired_REV: { name: "O1000.8", type: "BOOL" },
};

export const isAlias = (alias) =>
  Object.prototype.hasOwnProperty.call(TAGS, alias);

/** Resolve an alias to its real PLC address; pass through unknown names so the
 * real driver can still read/write arbitrary tags for diagnostics. */
export const resolveName = (alias) =>
  isAlias(alias) ? TAGS[alias].name : alias;

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
