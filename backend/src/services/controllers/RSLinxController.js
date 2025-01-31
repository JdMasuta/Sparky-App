// simplifiedRSLinxController.js
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class DDEClient {
  constructor() {
    this.pythonScript = join(__dirname, "dde_manager.py");
  }

  async executeDDECommand(command) {
    return new Promise((resolve, reject) => {
      const python = spawn("python", [
        this.pythonScript,
        JSON.stringify(command),
      ]);

      let dataString = "";

      python.stdout.on("data", (data) => {
        dataString += data.toString();
      });

      python.stderr.on("data", (data) => {
        console.error(`Python Error: ${data}`);
      });

      python.on("close", (code) => {
        try {
          const result = JSON.parse(dataString);
          resolve(result);
        } catch (e) {
          reject(new Error("Failed to parse Python output"));
        }
      });
    });
  }

  async readTag(tag) {
    const command = {
      action: "read",
      application: "RSLinx",
      topic: "ExcelLink",
      item: tag,
    };
    return this.executeDDECommand(command);
  }

  async writeTag(tag, value) {
    const command = {
      action: "write",
      application: "RSLinx",
      topic: "ExcelLink",
      item: tag,
      value: value,
    };
    return this.executeDDECommand(command);
  }

  async checkConnection() {
    const command = {
      action: "check",
      application: "RSLinx",
      topic: "ExcelLink",
    };
    return this.executeDDECommand(command);
  }
}

// Create singleton instance
const ddeClient = new DDEClient();

// Controller methods
export const getTagValue = async (req, res) => {
  try {
    const { tagName } = req.params;
    const result = await ddeClient.readTag(tagName);
    res.json({
      tag: tagName,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const writeTagValue = async (req, res) => {
  try {
    const { tagName } = req.params;
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: "Value is required" });
    }

    const result = await ddeClient.writeTag(tagName, value);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getBatchTagValues = async (req, res) => {
  try {
    const { tags } = req.body;

    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: "Tags must be an array" });
    }

    const results = {};
    for (const tag of tags) {
      results[tag] = await ddeClient.readTag(tag);
    }

    res.json({
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const writeBatchTags = async (req, res) => {
  try {
    const { tags } = req.body;

    if (!tags || typeof tags !== "object") {
      return res
        .status(400)
        .json({ error: "Tags must be an object mapping tagNames to values" });
    }

    const results = {};
    for (const [tagName, value] of Object.entries(tags)) {
      results[tagName] = await ddeClient.writeTag(tagName, value);
    }

    res.json({
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getConnectionStatus = async (req, res) => {
  try {
    const status = await ddeClient.checkConnection();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const reconnectRSLinx = async (req, res) => {
  try {
    const status = await ddeClient.checkConnection();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const validateTagConnection = async (req, res) => {
  try {
    const { tagName } = req.params;
    const result = await ddeClient.readTag(tagName);
    res.json({
      valid: !result.error,
      error: result.error,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const runDiagnostics = async (req, res) => {
  try {
    const connectionStatus = await ddeClient.checkConnection();

    const diagnosticResults = {
      configuration: {
        server: "RSLinx",
        topic: "ExcelLink",
        connectionType: "DDE",
      },
      connection: {
        status: connectionStatus.available,
        error: connectionStatus.available ? null : connectionStatus.message,
      },
      timestamp: new Date().toISOString(),
    };

    res.json(diagnosticResults);
  } catch (error) {
    res.status(500).json({
      error: "Diagnostic test failed",
      details: error.message,
    });
  }
};

export const writeSequence = async (req, res) => {
  try {
    const { name, moNumber, itemNumber } = req.body;

    if (!name || !moNumber || !itemNumber) {
      return res.status(400).json({
        error: "name, moNumber, and itemNumber are all required",
      });
    }

    // Define tags
    const userName = "_200_GLB.StringData[0]";
    const moNumberTag = "_200_GLB.StringData[1]";
    const itemNumberTag = "_200_GLB.StringData[2]";
    const completeAck = "CompleteAck";
    const stepNumber = "_200_GLB.DintData[2]";

    let currentStep = 1;

    // Step 1: Write userName
    await ddeClient.writeTag(userName, name);
    await ddeClient.writeTag(stepNumber, currentStep++);

    // Step 2: Write moNumber
    await ddeClient.writeTag(moNumberTag, moNumber);
    await ddeClient.writeTag(stepNumber, currentStep++);

    // Step 3: Write itemNumber
    await ddeClient.writeTag(itemNumberTag, itemNumber);
    await ddeClient.writeTag(stepNumber, currentStep++);

    // Step 4: Write completeAck
    await ddeClient.writeTag(completeAck, true);
    await ddeClient.writeTag(stepNumber, currentStep);

    res.json({
      success: true,
      message: "Sequential write completed successfully",
      finalStep: currentStep,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

const monitoringSessions = new Map(); // Track active sessions

export const monitorQuantity = async (req, res) => {
  const { sessionId } = req.params; // Extract sessionId from the route
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  const abortController = new AbortController();
  monitoringSessions.set(sessionId, abortController);

  try {
    const {
      pollInterval = 500,
      timeout = 600000,
      quantityThreshold = 0,
    } = req.query;

    const quantityTag = "Reel.RealData[0]";
    const completeRequestTag = "_200_GLB.BoolData[0].0";

    const startTime = Date.now();
    let quantity = null;
    let lastCompleteRequest = "0";

    while (Date.now() - startTime < Number(timeout)) {
      if (abortController.signal.aborted) {
        console.log(`Monitoring session ${sessionId} was aborted.`);
        return res.status(200).json({ success: false, aborted: true });
      }

      const completeRequestResult = await ddeClient.readTag(completeRequestTag);
      const completeRequest = completeRequestResult.value;

      if (completeRequest === "1") {
        const quantityResult = await ddeClient.readTag(quantityTag);
        quantity = quantityResult.value;
      }

      const numericQuantity = quantity !== null ? Number(quantity) : 0;
      const numericThreshold = Number(quantityThreshold);

      const thresholdCheck =
        numericThreshold === 0 || numericQuantity >= numericThreshold;

      if (completeRequest === "1" && quantity !== null && thresholdCheck) {
        monitoringSessions.delete(sessionId);
        return res.json({
          success: true,
          finalQuantity: quantity,
          finalCompleteRequest: completeRequest,
          timeElapsed: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
      }

      lastCompleteRequest = completeRequest;

      await new Promise((resolve) => setTimeout(resolve, Number(pollInterval)));
    }

    monitoringSessions.delete(sessionId);
    res.json({
      success: false,
      finalQuantity: quantity || "0",
      finalCompleteRequest: lastCompleteRequest,
      timeElapsed: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    monitoringSessions.delete(sessionId);
    res.status(500).json({ error: error.message });
  }
};

// Endpoint to stop monitoring
export const stopMonitoring = (req, res) => {
  const { sessionId } = req.body;
  const controller = monitoringSessions.get(sessionId);

  if (!controller) {
    return res.status(404).json({ error: "Session not found" });
  }

  controller.abort(); // Cancel the session
  monitoringSessions.delete(sessionId); // Clean up
  res.json({
    success: true,
    message: `Monitoring session ${sessionId} stopped.`,
  });
};
