const { Controller, Tag, EthernetIP } = require("ethernet-ip");
const { SINT, BOOL, STRING, DINT } = EthernetIP.CIP.DataTypes.Types;

// ------------------ CONFIGURATION ------------------
const PLC_IP = "192.168.1.251"; // Replace with your PLC's IP address
const PLC_SLOT = 0; // Replace with your PLC's slot (often 0)
const ALLOWED_ORIGIN = "*"; // Allowed origin for WebSocket connections
const AUTH_TOKEN = "123"; // Replace with your key-pair or token secret
// ----------------------------------------------------

// ------------------ TAG LOOKUP TABLE ----------------
const TAGS = {
  quantity: { name: "Reel.RealData[0]", type: SINT },
  backupQuantity: { name: "Reel.RealData[10]", type: SINT },
  completeRequest: { name: "_200_GLB.BoolData[0].0", type: BOOL },
  userName: { name: "_200_GLB.StringData[0]", type: STRING },
  moNumber: { name: "_200_GLB.StringData[1]", type: STRING },
  itemNumber: { name: "_200_GLB.StringData[2]", type: STRING },
  completeAck: { name: "CompleteAck", type: "?" },
  stepNumber: { name: "_200_GLB.DintData[2]", type: DINT },
  test: { name: "_200_GLB.DintData[10]", type: DINT },
};
// ----------------------------------------------------

/**
 * Utility functions to get a tag's name and data type.
 */

function lookupTagName(tagName) {
  return TAGS[tagName].name;
}

function lookupTagType(tagName) {
  return TAGS[tagName].type;
}

/**
 * Utility function to read a PLC tag.
 */
async function plcRead(tagName) {
  const plc = new Controller();
  async function readOne(tag) {
    plc.on("error", (err) => {
      console.error("PLC Controller error in plcRead:", err.message);
    });
    try {
      await plc.connect(PLC_IP, PLC_SLOT);
      await plc.readTag(tag);
      return tag.state.tag;
    } catch (err) {
      throw new Error(`Error reading tag '${tagName}': ${err.message}`);
    }
  }
  tagType = lookupTagType(tagName);
  if (tagType != STRING) {
    console.log("Read Tag Name:", tagName);
    const tag = new Tag(lookupTagName(tagName));
    x = await readOne(tag);
    console.log("Tag:", x);
    return x;
  }
  // If the tag is a string, read the first three elements
  // TEST THIS
  else if (tagType == STRING) {
    let tags = [];
    for (let i = 0; i < 3; i++) {
      try {
        let a = lookupTagName(tagName) + `.DATA[${i}]`;
        console.log("Read Tag Name:", a);
        let tag = new Tag(a);
        tags.push(await readOne(tag));
        console.log("Tag:", tags[i]);
      } catch (err) {
        console.error("Error reading string tag:", err.message);
        return "Failed"; // or handle the error as needed
      }
    }
    return tags;
  } else {
    throw new Error(`Unsupported tag type '${tagType}' for tag '${tagName}'`);
  }
}

/**
 * Utility function to write a value to a PLC tag.
 */
async function plcWrite(tagName, value) {
  const plc = new Controller();
  async function writeOne(tag) {
    plc.on("error", (err) => {
      console.error("PLC Controller error in plcWrite:", err.message);
    });
    try {
      await plc.connect(PLC_IP, PLC_SLOT);
      await plc.writeTag(tag);
      return tag;
    } catch (err) {
      throw new Error(`Error writing tag '${tag.name}': ${err.message}`);
    }
  }
  tagType = lookupTagType(tagName);
  if (tagType != STRING) {
    const tag = new Tag(lookupTagName(tagName), null, DINT);
    tag.value = value;
    console.log("Write Tag Name:", tag.name);
    return await writeOne(tag);
  }
  // If the tag is a string, read the first three elements
  // TEST THIS
  else if (tagType == STRING) {
    let tags = [];
    for (let i = 0; i < value.length; i++) {
      let tag = new Tag(lookupTagName(tagName) + `[${i}]`, null, tagType);
      tag.value = value.charCodeAt(i);
      tags.push(await writeOne(tag));
      console.log("Write Tag Name:", tag.name);
    }
    return tags;
  }
}

// ------------------ IN-MEMORY MONITORING SESSIONS ------------------
// Each session maps a sessionId to a cancellation token (object with an `aborted` property)
const monitoringSessions = new Map();

// ------------------ CONTROLLER FUNCTIONS ------------------

// GET /tags/:tagName
async function getTag(req, res) {
  try {
    const tagData = await plcRead(req.params.tagName);
    if (tagData.hasOwnProperty("name")) {
      res.json({ tag: tagData.name, value: tagData.value });
    } else {
      console.log("Tag Data:", tagData);
      const value = tagData
        .map((tag) => String.fromCharCode(tag?.value) ?? "")
        .join("");
      res.json({ tag: req.params.tagName, value });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /tags/:tagName
async function postTag(req, res) {
  try {
    const tagName = req.params.tagName;
    const { value } = req.body;
    const result = await plcWrite(tagName, value);
    if (result.hasOwnProperty("name")) {
      res.json({ tag: tagName, result });
    } else {
      console.log("Tag Data:", result);
      res.json({
        tag: tagName,
        result: result.map((tag) => String.fromCharCode(tag?.value) ?? ""),
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /batch/read
async function batchRead(req, res) {
  try {
    // Expecting { tags: ["Tag1", "Tag2", ...] }
    const tags = req.body.tags;
    const results = {};
    for (const tag of tags) {
      try {
        results[tag] = await plcRead(tag);
      } catch (err) {
        results[tag] = `Error: ${err.message}`;
      }
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /batch/write
async function batchWrite(req, res) {
  try {
    // Expecting { tags: { "Tag1": "value1", "Tag2": "value2", ... } }
    const tags = req.body.tags;
    const results = {};
    for (const tag in tags) {
      try {
        results[tag] = await plcWrite(tag, tags[tag]);
      } catch (err) {
        results[tag] = `Error: ${err.message}`;
      }
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /status
async function getStatus(req, res) {
  try {
    const plc = new Controller();
    plc.on("error", (err) => {
      console.error("PLC Controller error in getStatus:", err.message);
    });
    await plc.connect(PLC_IP, PLC_SLOT);
    res.json({ connected: true });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
}

// POST /reconnect
async function reconnect(req, res) {
  try {
    const plc = new Controller();
    plc.on("error", (err) => {
      console.error("PLC Controller error in reconnect:", err.message);
    });
    await plc.connect(PLC_IP, PLC_SLOT);
    await plc.disconnect();
    res.json({ reconnected: true });
  } catch (err) {
    res.status(500).json({ error: `Reconnect failed: ${err.message}` });
  }
}

// GET /monitor/:sessionId
async function monitor(req, res) {
  const sessionId = req.params.sessionId;
  if (monitoringSessions.has(sessionId)) {
    return res.status(400).json({ error: "Session already exists" });
  }

  // Query parameters (with defaults)
  const pollInterval = parseInt(req.query.pollInterval) || 500; // milliseconds
  const timeout = parseInt(req.query.timeout) || 600000; // milliseconds
  const quantityThreshold = parseFloat(req.query.quantityThreshold) || 0;

  // Create a cancellation token
  const cancelToken = { aborted: false };
  monitoringSessions.set(sessionId, cancelToken);

  const startTime = Date.now();
  let quantity = null;
  let lastCompleteRequest = "0";

  const quantityTag = "Reel.RealData[10]";
  const completeRequestTag = "_200_GLB.BoolData[0].0";

  async function monitorTask() {
    while (Date.now() - startTime < timeout) {
      if (cancelToken.aborted) {
        return { success: false, aborted: true };
      }

      let completeRequest;
      try {
        completeRequest = await plcRead(completeRequestTag);
        completeRequest = String(completeRequest);
      } catch (err) {
        return { error: err.message };
      }

      if (completeRequest === "1") {
        try {
          quantity = await plcRead(quantityTag);
        } catch (err) {
          return { error: err.message };
        }
      }

      const numericQuantity = quantity !== null ? parseFloat(quantity) : 0;
      const thresholdCheck =
        quantityThreshold === 0 || numericQuantity >= quantityThreshold;

      if (completeRequest === "1" && quantity !== null && thresholdCheck) {
        break;
      }

      lastCompleteRequest = completeRequest;
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    const elapsed = Date.now() - startTime;
    return {
      success:
        lastCompleteRequest === "1" &&
        quantity !== null &&
        (quantityThreshold === 0 || parseFloat(quantity) >= quantityThreshold),
      finalQuantity: quantity !== null ? quantity : "0",
      finalCompleteRequest: lastCompleteRequest,
      timeElapsed: elapsed,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const result = await monitorTask();
    monitoringSessions.delete(sessionId);
    res.json(result);
  } catch (err) {
    monitoringSessions.delete(sessionId);
    res.status(500).json({ error: err.message });
  }
}

// POST /monitor/stop
function stopMonitor(req, res) {
  const sessionId = req.body.sessionId;
  if (!monitoringSessions.has(sessionId)) {
    return res.status(404).json({ error: "Session not found" });
  }
  const cancelToken = monitoringSessions.get(sessionId);
  cancelToken.aborted = true;
  monitoringSessions.delete(sessionId);
  res.json({
    success: true,
    message: `Monitoring session ${sessionId} stopped.`,
  });
}

// WebSocket Endpoint Handler
function wsHandler(ws, req) {
  // Validate the Origin header
  const origin = req.headers.origin;
  if (origin !== ALLOWED_ORIGIN) {
    ws.close(1008, "Origin not allowed");
    return;
  }

  // Validate the Authorization header
  const token = req.headers.authorization;
  if (token !== `Bearer ${AUTH_TOKEN}`) {
    ws.close(1008, "Unauthorized");
    return;
  }

  ws.on("message", (msg) => {
    // Echo the message back for this example
    ws.send(`Message received: ${msg}`);
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
  });
}

module.exports = {
  AUTH_TOKEN,
  getTag,
  postTag,
  batchRead,
  batchWrite,
  getStatus,
  reconnect,
  monitor,
  stopMonitor,
  wsHandler,
};
