// RSLinx DDE Configuration
const config = {
  // Server Settings
  application: "RSLinx", // DDE server name
  topic: process.env.RSLINX_TOPIC || "ExcelLink",

  // DDE Link Settings
  defaultRow: "L1",
  defaultColumn: "C1",

  // Tag Definitions - Using RSLinx DDE addressing format
  tags: {
    read: {
      quantity: {
        item: "Reel.RealData[0]",
        row: "L1",
        column: "C1",
      },
      completeRequest: {
        item: "_200_GLB.BoolData[0].0",
        row: "L1",
        column: "C1",
      },
      ddeTest: {
        item: "DDETest",
        row: "L1",
        column: "C1",
      },
    },
    write: {
      userName: {
        item: "_200_GLB.StringData[0]",
        row: "L1",
        column: "C1",
      },
      moNumber: {
        item: "_200_GLB.StringData[1]",
        row: "L1",
        column: "C1",
      },
      itemNumber: {
        item: "_200_GLB.StringData[2]",
        row: "L1",
        column: "C1",
      },
      completeAck: {
        item: "CompleteAck",
        row: "L1",
        column: "C1",
      },
      stepNumber: {
        item: "_200_GLB.DintData[2]",
        row: "L1",
        column: "C1",
      },
    },
  },

  // Data Type Mappings for DDE
  dataTypes: {
    userName: "STRING",
    moNumber: "STRING",
    itemNumber: "STRING",
    completeAck: "BOOL",
    stepNumber: "DINT",
    quantity: "REAL",
    completeRequest: "BOOL",
    ddeTest: "REAL",
  },

  // Connection Settings
  connection: {
    maxRetries: parseInt(process.env.DDE_MAX_RETRIES || "3"),
    retryInterval: parseInt(process.env.DDE_RETRY_INTERVAL || "5000"),
  },

  // Cache Settings
  cache: {
    enabled: process.env.DDE_CACHE_ENABLED === "true",
    updateRate: parseInt(process.env.DDE_CACHE_UPDATE_RATE || "1000"),
  },
};

export default config;
