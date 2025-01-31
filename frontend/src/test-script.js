// RSLinxTester.js - Browser-based testing utility for DDE RSLinx implementation
const RSLinxTester = {
  // Base URL for API calls
  baseUrl: "http://localhost:3000/api/rslinx",

  // Tag Definitions - Using RSLinx DDE addressing format
  tag: {
    quantity: "Reel.RealData[0]",
    completeRequest: "_200_GLB.BoolData[0].0",
    ddeTest: "DDETest",
    userName: "_200_GLB.StringData[0]",
    moNumber: "_200_GLB.StringData[1]",
    itemNumber: "_200_GLB.StringData[2]",
    completeAck: "CompleteAck",
    stepNumber: "_200_GLB.DintData[2]",
  },

  // Helper method to handle API responses
  async handleApiResponse(response, actionName) {
    const contentType = response.headers.get("content-type");
    let data;

    try {
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        console.error(
          `Unexpected response type for ${actionName}:`,
          contentType
        );
        console.error("Response text:", text);
        throw new Error(`Unexpected response type: ${contentType}`);
      }
    } catch (error) {
      console.error(`Error parsing response for ${actionName}:`, error);
      throw error;
    }

    if (!response.ok) {
      console.error(
        `${actionName} failed with status ${response.status}:`,
        data
      );
      throw new Error(data.error || data.message || "Unknown error occurred");
    }

    return data;
  },

  // Test connection status
  async testConnection() {
    console.log("Testing DDE RSLinx connection...");
    try {
      const response = await fetch(`${this.baseUrl}/status`);
      const data = await this.handleApiResponse(response, "Connection test");
      console.log("Connection status:", {
        available: data.available,
        message: data.message,
      });
      return data;
    } catch (error) {
      console.error("Connection test failed:", error);
      throw error;
    }
  },

  // Test reading a tag
  async testReadTag(tagName) {
    console.log(`Testing read of DDE tag: ${tagName}`);
    try {
      const encodedTag = encodeURIComponent(tagName);
      const response = await fetch(`${this.baseUrl}/tags/${encodedTag}`);
      const data = await response.json();

      if (response.ok) {
        console.log("Tag read successful:", {
          name: tagName,
          value: data.value,
          timestamp: data.timestamp,
          error: data.error,
        });
      } else {
        console.error("Tag read failed:", data.error);
      }

      return data;
    } catch (error) {
      console.error("Read test failed:", error);
      throw error;
    }
  },

  // Test writing to a tag
  async testWriteTag(tagName, value) {
    console.log(`Testing write to DDE tag: ${tagName} with value: ${value}`);
    try {
      const encodedTag = encodeURIComponent(tagName);
      const response = await fetch(`${this.baseUrl}/tags/${encodedTag}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value }),
      });
      const data = await response.json();

      if (response.ok) {
        console.log("Tag write successful:", {
          name: tagName,
          success: data.success,
          error: data.error,
        });
      } else {
        console.error("Tag write failed:", data.error);
      }

      return data;
    } catch (error) {
      console.error("Write test failed:", error);
      throw error;
    }
  },

  // Test batch read
  async testBatchRead(tags) {
    console.log("Testing batch read of DDE tags:", tags);
    try {
      const response = await fetch(`${this.baseUrl}/batch/read`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tags }),
      });
      const data = await response.json();

      console.log("Batch read results:");
      Object.entries(data.results).forEach(([tag, result]) => {
        if (result.error) {
          console.error(`- ${tag}: Failed - ${result.error}`);
        } else {
          console.log(`- ${tag}: ${result.value}`);
        }
      });
      console.log("Timestamp:", data.timestamp);

      return data;
    } catch (error) {
      console.error("Batch read test failed:", error);
      throw error;
    }
  },

  // Test batch write
  async testBatchWrite(tags) {
    console.log("Testing batch write of DDE tags:", tags);
    try {
      const response = await fetch(`${this.baseUrl}/batch/write`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tags }),
      });
      const data = await response.json();

      console.log("Batch write results:");
      Object.entries(data.results).forEach(([tag, result]) => {
        if (result.error) {
          console.error(`- ${tag}: Failed - ${result.error}`);
        } else {
          console.log(`- ${tag}: Success`);
        }
      });

      return data;
    } catch (error) {
      console.error("Batch write test failed:", error);
      throw error;
    }
  },

  // Test tag validation
  async testTagValidation(tagName) {
    console.log(`Testing validation of DDE tag: ${tagName}`);
    try {
      const encodedTag = encodeURIComponent(tagName);
      const response = await fetch(`${this.baseUrl}/validate/${encodedTag}`);
      const data = await response.json();

      if (data.valid) {
        console.log(`Tag '${tagName}' is valid and accessible`);
      } else {
        console.error(`Tag '${tagName}' validation failed:`, data.error);
      }

      return data;
    } catch (error) {
      console.error("Validation test failed:", error);
      throw error;
    }
  },

  // Full Diagnostic
  async runDiagnostics() {
    console.log("Running DDE RSLinx diagnostics...");
    try {
      const response = await fetch(`${this.baseUrl}/diagnostics`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Pretty print the results
      console.log("\nDDE RSLinx Diagnostic Results:");
      console.log("============================");

      // Configuration
      console.log("\nConfiguration:");
      console.log("--------------");
      Object.entries(data.configuration).forEach(([key, value]) => {
        console.log(`${key}: ${String(value)}`);
      });

      // Connection Status
      console.log("\nConnection Status:");
      console.log("-----------------");
      console.log(`Status: ${data.connection.status ? "Connected" : "Failed"}`);
      if (data.connection.error) {
        console.log(`Error: ${data.connection.error}`);
      }

      console.log("\nTimestamp:", data.timestamp);

      // Troubleshooting tips if there are issues
      if (!data.connection.status) {
        console.log("\nTroubleshooting steps:");
        console.log("1. Verify that RSLinx is running");
        console.log("2. Check if the DDE service is enabled in RSLinx");
        console.log("3. Verify the API server is running on port 3000");
        console.log(
          "4. Check that the Python DDE bridge is properly installed"
        );
        console.log("5. Verify windows DDE service is running");
      }

      return data;
    } catch (error) {
      console.error("Diagnostic test failed:", error.message);
      throw error;
    }
  },

  // Run all tests with specific tags
  async runAllTests(readTag, writeTag) {
    if (!readTag || !writeTag) {
      throw new Error("Both readTag and writeTag must be provided for testing");
    }

    console.log("Running all DDE RSLinx tests...");
    try {
      console.log("\n1. Connection Test");
      console.log("----------------");
      await this.testConnection();

      console.log("\n2. Diagnostics");
      console.log("-------------");
      await this.runDiagnostics();

      console.log("\n3. Read Test");
      console.log("-----------");
      await this.testReadTag(readTag);

      console.log("\n4. Write Test");
      console.log("------------");
      await this.testWriteTag(writeTag, 42);

      console.log("\n5. Batch Operations");
      console.log("------------------");
      await this.testBatchRead([readTag]);
      await this.testBatchWrite({ [writeTag]: 42 });

      console.log("\n6. Tag Validation");
      console.log("----------------");
      await this.testTagValidation(readTag);

      console.log("\nAll tests completed successfully!");
    } catch (error) {
      console.error("Test suite failed:", error);
      throw error;
    }
  },

  async testSequentialWrite() {
    console.log("Starting sequential write test...");

    try {
      const response = await fetch(`${this.baseUrl}/sequence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "TEST",
          moNumber: "420690",
          itemNumber: "123789",
        }),
      });

      const data = await this.handleApiResponse(response, "Sequential write");

      console.log("\nSequential write test completed:", data);
      return data;
    } catch (error) {
      console.error("Sequential write test failed:", error);
      throw error;
    }
  },

  async monitorResponse(options = {}) {
    const defaultOptions = {
      pollInterval: 500,
      timeout: 30000,
      quantityThreshold: 0,
      completeRequestExpected: "1",
    };

    const config = { ...defaultOptions, ...options };
    console.log("Starting DDE response monitoring with config:", config);

    const startTime = Date.now();
    let lastQuantity = "0";
    let lastCompleteRequest = "0";

    while (Date.now() - startTime < config.timeout) {
      try {
        const response = await fetch(`${this.baseUrl}/monitor`);
        const data = await this.handleApiResponse(response, "Monitor quantity");

        const quantity = data.finalQuantity;
        const completeRequest = data.completeRequest;

        // Log only if values have changed
        if (
          quantity !== lastQuantity ||
          completeRequest !== lastCompleteRequest
        ) {
          console.log(`\nCurrent values at ${data.timestamp}:`);
          console.log(`- Quantity: ${quantity}`);
          console.log(`- Complete Request: ${completeRequest}`);
          lastQuantity = quantity;
          lastCompleteRequest = completeRequest;
        }

        // Check if we've met our conditions
        const quantityOk =
          config.quantityThreshold === 0 ||
          (quantity !== null &&
            Number(quantity) >= Number(config.quantityThreshold));
        const completeRequestOk =
          completeRequest === config.completeRequestExpected;

        if (quantityOk && completeRequestOk) {
          console.log("\nDesired conditions met!");
          return {
            success: true,
            finalQuantity: quantity,
            finalCompleteRequest: completeRequest,
            timeElapsed: Date.now() - startTime,
          };
        }

        await new Promise((resolve) =>
          setTimeout(resolve, config.pollInterval)
        );
      } catch (error) {
        console.error("Error during monitoring:", error);
        throw error;
      }
    }

    // Timeout case
    console.error("\nTimeout waiting for desired conditions!");
    return {
      success: false,
      finalQuantity: lastQuantity,
      finalCompleteRequest: lastCompleteRequest,
      timeElapsed: Date.now() - startTime,
    };
  },
  // Convenience method to run the full test sequence
  async runFullTest(options = {}) {
    try {
      console.log("Starting full test sequence...");

      // First run the sequential write test
      await this.testSequentialWrite();

      console.log("\nWaiting for DDE response...");
      // Then monitor for the response
      const result = await this.monitorResponse(options);

      if (result.success) {
        console.log("\nTest sequence completed successfully!");
      } else {
        console.log("\nTest sequence completed with timeout!");
      }

      console.log("Final Results:", result);
      return result;
    } catch (error) {
      console.error("Full test sequence failed:", error);
      throw error;
    }
  },
};

// Make it globally available in the browser
window.RSLinxTester = RSLinxTester;

// Usage example:
// RSLinxTester.runAllTests('_200_GLB.DintData[2]', '_200_GLB.DintData[3]');
