import { PLC, CIPDataType } from "ethernet-ip";

// ------------------ CONFIGURATION ------------------
const PLC_IP = process.env.PLC_IP ?? "192.168.1.70";
export const AUTH_TOKEN = process.env.PLC_AUTH_TOKEN ?? "1023";
// ----------------------------------------------------

// ------------------ TAG LOOKUP TABLE ----------------
const TAGS = {
  quantity: { name: "Reel.RealData[0]", type: CIPDataType.SINT },
  backupQuantity: { name: "Reel.RealData[10]", type: CIPDataType.SINT },
  completeRequest: { name: "_200_GLB.BoolData[0].0", type: CIPDataType.BOOL },
  userName: { name: "_200_GLB.StringData[0]", type: CIPDataType.STRING },
  moNumber: { name: "_200_GLB.StringData[1]", type: CIPDataType.STRING },
  itemNumber: { name: "_200_GLB.StringData[2]", type: CIPDataType.STRING },
  completeAck: { name: "CompleteAck", type: CIPDataType.BOOL }, // was "?" — adjust if not actually BOOL
  stepNumber: { name: "_200_GLB.DintData[2]", type: CIPDataType.DINT },
  test: { name: "_200_GLB.Description", type: CIPDataType.STRING },
  testWrite: { name: "_200_GLB.DintData[49]", type: CIPDataType.DINT },
  testWrite2: { name: "_200_GLB.DintData[48]", type: CIPDataType.DINT },
};
// ----------------------------------------------------

async function getTagFromName(tagName) {
  if (TAGS[tagName]) {
    return TAGS[tagName];
  }
  // Unknown tag — read once to let the registry discover and cache the type.
  // Required before any write, since plc.write() needs to know how to serialize.
  const plc = await getPLC();
  try {
    await plc.read(tagName);
  } catch (error) {
    throw new Error(`Tag ${tagName} not readable from PLC: ${error.message}`);
  }
  console.log(`Resolved unknown tag "${tagName}" via PLC discovery`);
  return { name: tagName };
}

// ------------------ PLC CONNECTION ------------------
// One long-lived PLC connection per process. autoReconnect handles drops
// without re-running registry.define, so reads/writes stay cheap.
let plcInstance = null;
let plcInitPromise = null;

async function getPLC() {
  if (plcInstance) return plcInstance;
  if (plcInitPromise) return plcInitPromise; // dedupe concurrent first connects

  plcInitPromise = (async () => {
    const plc = new PLC();
    await plc.connect(PLC_IP, {
      autoReconnect: {
        enabled: true,
        initialDelay: 1000,
        maxDelay: 30000,
        multiplier: 2,
        maxRetries: Infinity,
      },
    });

    for (const tag of Object.values(TAGS)) {
      plc.registry.define(tag.name, tag.type);
    }

    // plc.on("connected", () => console.log("PLC connected"));
    // plc.on("disconnected", () => console.log("PLC disconnected"));
    // plc.on("reconnecting", (attempt) =>
    //   console.log(`PLC reconnect attempt ${attempt}...`),
    // );
    plc.on("error", (err) => console.error("PLC error:", err.message));

    console.log("PLC initial connection established");
    return plc;
  })();

  try {
    plcInstance = await plcInitPromise;
    return plcInstance;
  } catch (error) {
    plcInitPromise = null; // allow retry on next call
    console.error("Error connecting to PLC:", error);
    throw error;
  }
}

/**
 * Read one or more PLC tags. Always returns an array, indexed the same as `tags`.
 */
async function readTags(tags) {
  console.log("Reading tags:", tags);
  const plc = await getPLC();
  const result = await plc.read(tags);
  // plc.read returns a bare value for single-tag reads; normalize to array
  return Array.isArray(result) ? result : [result];
}

/**
 * Write one or more values to PLC tags.
 * @param {Array<{name: string, data: any}>} tagData
 */
async function writeTags(tagData) {
  console.log("Writing tags:", tagData);
  const plc = await getPLC();
  for (const { name, data } of tagData) {
    await plc.write(name, data);
  }
}

// ------------------ ROUTE HANDLERS ------------------

// GET /tags/:tagName
export const getTag = async (req, res) => {
  let tag;
  try {
    tag = await getTagFromName(req.params.tagName);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const [value] = await readTags([tag.name]);
    res.status(200).json({
      message: "Tag read successfully",
      tag: tag.name,
      value,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error reading tag:", error);
    res
      .status(500)
      .json({ error: "Failed to read tag", message: error.message });
  }
};

// POST /tags/:tagName  body: { value }
export const postTag = async (req, res) => {
  let tag;
  try {
    tag = await getTagFromName(req.params.tagName);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    await writeTags([{ name: tag.name, data: req.body.value }]);
    res.status(200).json({
      message: "Tag updated successfully",
      tag: tag.name,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error updating tag:", error);
    res
      .status(500)
      .json({ error: "Failed to update tag", message: error.message });
  }
};

// POST /batch/read  body: { tags: ["quantity", "stepNumber", ...] }
export const batchRead = async (req, res) => {
  let tagNames;
  try {
    tagNames = await Promise.all(
      req.body.tags.map((name) => getTagFromName(name).then((tag) => tag.name)),
    );
  } catch (error) {
    console.error("Error parsing request body:", error);
    return res
      .status(400)
      .json({ error: "Invalid request body", message: error.message });
  }

  try {
    const tagData = await readTags(tagNames);
    const results = Object.fromEntries(
      tagNames.map((name, i) => [name, tagData[i]]),
    );
    res.status(200).json({
      message: "Tags read successfully",
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error reading tags:", error);
    res
      .status(500)
      .json({ error: "Failed to read tags", message: error.message });
  }
};

// POST /batch/write
export const batchWrite = async (req, res) => {
  let tags;
  try {
    if (!Array.isArray(req.body.tags)) {
      tags = await Promise.all(
        Object.entries(req.body.tags).map(async ([name, data]) => {
          const tagInfo = await getTagFromName(name);
          return { name: tagInfo.name, data };
        }),
      );
    } else {
      tags = await Promise.all(
        req.body.tags.map(async (tag) => {
          const tagInfo = await getTagFromName(tag.name);
          return { name: tagInfo.name, data: tag.data };
        }),
      );
    }
  } catch (error) {
    console.error("Error parsing request body:", error);
    return res
      .status(400)
      .json({ error: "Invalid request body", message: error.message });
  }

  try {
    await writeTags(tags);
    const results = Object.fromEntries(tags.map((t) => [t.name, "Success"]));
    res.status(200).json({
      message: "Tags updated successfully",
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error writing tags:", error);
    res
      .status(500)
      .json({ error: "Failed to update tags", message: error.message });
  }
};

// GET /status
export const getStatus = async (req, res) => {
  try {
    const plc = await getPLC();
    if (plc.isConnected) {
      return res.status(200).json({
        status: "connected",
        timestamp: new Date().toISOString(),
      });
    }
    return res.status(408).json({
      status: "disconnected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Status check failed:", error);
    return res.status(408).json({
      status: "disconnected",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

// ------------------ MONITORING SESSIONS -------------
const monitoringSessions = new Map(); // sessionId -> AbortController
// ----------------------------------------------------

// GET /monitor/:sessionId?pollInterval=&timeout=&quantityThreshold=
export const monitor = async (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }
  if (monitoringSessions.has(sessionId)) {
    return res
      .status(409)
      .json({ error: `Session ${sessionId} is already active` });
  }

  const {
    pollInterval = 500,
    timeout = 600000,
    quantityThreshold = 0,
  } = req.query;

  const numericPollInterval = Number(pollInterval);
  const numericTimeout = Number(timeout);
  const numericThreshold = Number(quantityThreshold);

  const quantityTag = await getTagFromName("quantity").name;
  const completeRequestTag = await getTagFromName("completeRequest").name;

  const abortController = new AbortController();
  monitoringSessions.set(sessionId, abortController);

  const startTime = Date.now();
  let quantity = 0;
  let completeRequest = false;

  try {
    while (Date.now() - startTime < numericTimeout) {
      if (abortController.signal.aborted) {
        console.log(`Monitoring session ${sessionId} was aborted.`);
        monitoringSessions.delete(sessionId);
        return res.status(200).json({
          message: "Monitoring session aborted",
          success: false,
          aborted: true,
          finalQuantity: quantity,
          finalCompleteRequest: completeRequest,
          timeElapsed: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
      }

      // Batch both reads into a single multi-service packet
      const [completeRequestValue, quantityValue] = await readTags([
        completeRequestTag,
        quantityTag,
      ]);
      completeRequest = completeRequestValue;
      quantity = quantityValue;

      const thresholdMet =
        numericThreshold === 0 || Number(quantity) >= numericThreshold;

      if (completeRequest && thresholdMet) {
        monitoringSessions.delete(sessionId);
        return res.status(200).json({
          message: "Monitoring completed successfully",
          success: true,
          finalQuantity: quantity,
          finalCompleteRequest: completeRequest,
          timeElapsed: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
      }

      await new Promise((resolve) => setTimeout(resolve, numericPollInterval));
    }

    monitoringSessions.delete(sessionId);
    res.status(200).json({
      message: "Monitoring timed out",
      success: false,
      finalQuantity: quantity,
      finalCompleteRequest: completeRequest,
      timeElapsed: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error monitoring:", error);
    monitoringSessions.delete(sessionId);
    res
      .status(500)
      .json({ error: "Failed to monitor", message: error.message });
  }
};

// POST /monitor/stop  body: { sessionId }
export const stopMonitor = (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  const controller = monitoringSessions.get(sessionId);
  if (!controller) {
    return res.status(404).json({ error: "Session not found" });
  }

  controller.abort();
  monitoringSessions.delete(sessionId);
  res.status(200).json({
    message: `Monitoring session ${sessionId} stopped`,
    timestamp: new Date().toISOString(),
  });
};
