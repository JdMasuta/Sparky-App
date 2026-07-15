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
