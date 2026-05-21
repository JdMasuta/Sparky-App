import { PLC, CIPDataType } from "ethernet-ip";

// ------------------ CONFIGURATION ------------------
const PLC_IP = "192.168.1.70"; // Replace with your PLC's IP address
const ALLOWED_ORIGIN = "*"; // Allowed origin for WebSocket connections
const AUTH_TOKEN = "1023"; // Replace with your key-pair or token secret
// ----------------------------------------------------

// ------------------ TAG LOOKUP TABLE ----------------
const TAGS = {
  quantity: { name: "Reel.RealData[0]", type: CIPDataType.SINT },
  backupQuantity: { name: "Reel.RealData[10]", type: CIPDataType.SINT },
  completeRequest: { name: "_200_GLB.BoolData[0].0", type: CIPDataType.BOOL },
  userName: { name: "_200_GLB.StringData[0]", type: CIPDataType.STRING },
  moNumber: { name: "_200_GLB.StringData[1]", type: CIPDataType.STRING },
  itemNumber: { name: "_200_GLB.StringData[2]", type: CIPDataType.STRING },
  completeAck: { name: "CompleteAck", type: "?" },
  stepNumber: { name: "_200_GLB.DintData[2]", type: CIPDataType.DINT },
  test: { name: "_200_GLB.Description", type: CIPDataType.STRING },
  testWrite: { name: "_200_GLB.DintData[49]", type: CIPDataType.DINT },
  testWrite2: { name: "_200_GLB.DintData[48]", type: CIPDataType.DINT },
};
// ----------------------------------------------------

function getTagFromName(tagName) {
  const tag = TAGS[tagName];
  if (!tag) {
    throw new Error(`Tag ${tagName} not found in lookup table.`);
  }
  return tag;
}

async function connectPLC() {
  try {
    const plc = new PLC();
    await plc.connect(PLC_IP, {
      autoReconnect: {
        enabled: false,
        initialDelay: 1000,
        maxDelay: 30000,
        multiplier: 2,
        maxRetries: Infinity,
      },
    });

    console.log("Connected");
    for (let i = 0; i < Object.keys(TAGS).length; i++) {
      const tag = Object.values(TAGS)[i];
      plc.registry.define(tag.name, tag.type);
    }
    return plc;

    // plc.on("disconnected", () => {
    //   console.log("Connection lost");
    // });

    // plc.on("reconnecting", (attempt) => {
    //   console.log(`Reconnect attempt ${attempt}...`);
    // });

    // plc.on("connected", () => {
    //   console.log("Connected");
    //   for (let i = 0; i < Object.keys(TAGS).length; i++) {
    //     const tag = Object.values(TAGS)[i];
    //     plc.registry.define(tag.name, tag.type);
    //   }
    //   return plc;
    //   // Tag registry is preserved — no re-discovery needed
    // });

    // plc.on("error", (err) => {
    //   console.error("Error:", err.message);
    // });
  } catch (error) {
    console.error("Error connecting to PLC:", error);
    throw error;
  }
}

/**
 * Utility function to read a PLC tag.
 */
async function readTags(tags) {
  console.log("Reading tags:", tags);
  try {
    const plc = await connectPLC();
    const tagData = await plc.read(tags);
    if (tagData.length === 1) {
      return tagData[0];
    } else {
      return tagData;
    }
  } catch (error) {
    console.error("Error reading tag:", error);
    throw error;
  }
}

/**
 * Utility function to write a value to a PLC tag.
 */
async function writeTags(tagData) {
  console.log("Writing tags:", tagData);
  try {
    const plc = await connectPLC();
    for (let i = 0; i < tagData.length; i++) {
      const res = await plc.write(tagData[i].name, tagData[i].data);
    }
    return "Success";
  } catch (error) {
    console.error("Error writing tag:", error);
    throw error;
  }
}

// GET /tags/:tagName
export const getTag = async (req, res) => {
  const tag = getTagFromName(req.params.tagName);
  try {
    const tagData = await readTags([tag.name]);
    res.status(200).json({
      message: "Tag read successfully",
      tag: tag.name,
      value: tagData,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error reading tag:", error);
    res.status(500).json({ error: "Failed to read Tag" });
  }
  return res;
};

export const postTag = async (req, res) => {
  const tag = getTagFromName(req.params.tagName);
  try {
    await writeTags([{ name: tag.name, data: req.body.value }]);
    res.status(200).json({
      message: "Tag updated successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error updating tag:", error);
    res.status(500).json({ error: "Failed to update tag" });
  }
};

export const batchRead = async (req, res) => {
  let tags;
  try {
    tags = req.body.tags.map((name) => getTagFromName(name).name);
  } catch (error) {
    console.error("Error parsing request body:", error);
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  try {
    const tagData = await readTags(tags);
    let results = {};
    for (let i = 0; i < tags.length; i++) {
      results[tags[i]] = tagData[i];
    }
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
    throw error;
  }
};

export const batchWrite = async (req, res) => {
  let tags;
  // we expect an array of objects with "name" and "data" properties
  try {
    tags = req.body.tags.map((tag) => {
      const tagInfo = getTagFromName(tag.name);
      return { name: tagInfo.name, data: tag.data };
    });
  } catch (error) {
    console.error("Error parsing request body:", error);
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  try {
    const result = await writeTags(tags);
    let results = {};
    for (let i = 0; i < tags.length; i++) {
      results[tags[i]] = result[i];
    }
    res.status(200).json({
      message: "Tags updated successfully",
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error writing tags:", error);
    res.status(500).json({ error: "Failed to update tags" });
    throw error;
  }
};

// Check old version of getStatus for reference, but we may want to implement a more robust status check that queries the PLC directly rather than relying on connection events
export const getStatus = async (req, res) => {
  const plc = await connectPLC();
  console.log("Connection status:", plc.isConnected);
  switch (plc.isConnected) {
    case false:
      res.status(408).json({ status: "disconnected" });
    case true:
      res.status(200).json({ status: "connected" });
  }
};

// ------------------ MONITORING SESSIONS -------------
const monitoringSessions = new Map(); // sessionId -> AbortController
// ----------------------------------------------------

// GET /monitor/:sessionId
export const monitor = async (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  const {
    pollInterval = 500,
    timeout = 600000,
    quantityThreshold = 0,
  } = req.query;

  const numericPollInterval = Number(pollInterval);
  const numericTimeout = Number(timeout);
  const numericThreshold = Number(quantityThreshold);

  const quantityTag = getTagFromName("quantity").name;
  const completeRequestTag = getTagFromName("completeRequest").name;

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
