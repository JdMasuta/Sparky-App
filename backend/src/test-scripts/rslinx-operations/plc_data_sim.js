import opcda from "node-opc-da";
import config from "../../services/config/rslinx.config.js";

class PLCSimulator {
  constructor() {
    this.data = {};
    this.server = null;
    this.group = null;
    this.items = new Map();
    this.running = false;
    this.updateInterval = null;
    this.simulationPatterns = new Map();
  }

  // Initialize simulator data
  initializeData() {
    // Initialize read tags
    for (const [tagName, tagPath] of Object.entries(config.tags.read)) {
      this.data[tagPath] = this.generateInitialValue(tagName);
    }

    // Initialize write tags
    for (const [tagName, tagPath] of Object.entries(config.tags.write)) {
      this.data[tagPath] = this.generateInitialValue(tagName);
    }

    // Set up simulation patterns
    this.setupSimulationPatterns();
  }

  // Generate appropriate initial values based on data type
  generateInitialValue(tagName) {
    const dataType = config.dataTypes[tagName];
    switch (dataType) {
      case "VT_BOOL":
        return false;
      case "VT_I4":
      case "VT_UI4":
        return 0;
      case "VT_R4":
        return 0.0;
      case "VT_BSTR":
        return "";
      default:
        return null;
    }
  }

  // Set up simulation patterns for different tag types
  setupSimulationPatterns() {
    for (const [tagName, tagPath] of Object.entries(config.tags.read)) {
      const dataType = config.dataTypes[tagName];

      switch (dataType) {
        case "VT_R4":
          // Sine wave pattern for real numbers
          this.simulationPatterns.set(tagPath, {
            type: "sine",
            amplitude: 100,
            frequency: 0.1,
            offset: 50,
            phase: Math.random() * Math.PI * 2,
          });
          break;

        case "VT_BOOL":
          // Toggle pattern for booleans
          this.simulationPatterns.set(tagPath, {
            type: "toggle",
            interval: 5000 + Math.random() * 5000,
          });
          break;

        case "VT_I4":
        case "VT_UI4":
          // Ramp pattern for integers
          this.simulationPatterns.set(tagPath, {
            type: "ramp",
            min: 0,
            max: 1000,
            increment: 1,
          });
          break;

        case "VT_BSTR":
          // Rotating text pattern
          this.simulationPatterns.set(tagPath, {
            type: "text",
            values: ["Running", "Paused", "Setup", "Error", "Maintenance"],
            currentIndex: 0,
          });
          break;
      }
    }
  }

  // Update simulated values based on patterns
  updateSimulatedValues() {
    const timestamp = Date.now();

    for (const [tagPath, pattern] of this.simulationPatterns) {
      switch (pattern.type) {
        case "sine":
          this.data[tagPath] =
            pattern.offset +
            pattern.amplitude *
              Math.sin(timestamp * pattern.frequency + pattern.phase);
          break;

        case "toggle":
          if (timestamp % pattern.interval < 100) {
            this.data[tagPath] = !this.data[tagPath];
          }
          break;

        case "ramp":
          this.data[tagPath] += pattern.increment;
          if (this.data[tagPath] > pattern.max) {
            this.data[tagPath] = pattern.min;
          }
          break;

        case "text":
          if (timestamp % 10000 < 100) {
            pattern.currentIndex =
              (pattern.currentIndex + 1) % pattern.values.length;
            this.data[tagPath] = pattern.values[pattern.currentIndex];
          }
          break;
      }
    }
  }

  // Start the simulator
  async start() {
    if (this.running) {
      console.log("Simulator is already running");
      return;
    }

    try {
      // Initialize data
      this.initializeData();

      // Create OPC DA server
      const client = new opcda.Client();
      this.server = await client.connectServer({
        progId: config.progId,
        clsid: config.clsid,
      });

      // Create group
      this.group = await this.server.addGroup({
        name: "SimulatorGroup",
        updateRate: 1000,
        deadband: 0,
      });

      // Add items to group
      for (const tagPath of Object.keys(this.data)) {
        const item = await this.group.addItem({
          itemID: tagPath,
          active: true,
        });
        this.items.set(tagPath, item);
      }

      // Start simulation loop
      this.running = true;
      this.updateInterval = setInterval(() => {
        this.updateSimulatedValues();
        this.updateOPCItems();
      }, 100);

      console.log("Simulator started successfully");
    } catch (error) {
      console.error("Failed to start simulator:", error);
      await this.stop();
      throw error;
    }
  }

  // Stop the simulator
  async stop() {
    if (!this.running) {
      return;
    }

    try {
      // Clear update interval
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }

      // Remove items
      for (const item of this.items.values()) {
        await item.remove();
      }
      this.items.clear();

      // Remove group
      if (this.group) {
        await this.group.remove();
        this.group = null;
      }

      // Disconnect server
      if (this.server) {
        await this.server.disconnect();
        this.server = null;
      }

      this.running = false;
      console.log("Simulator stopped successfully");
    } catch (error) {
      console.error("Error stopping simulator:", error);
      throw error;
    }
  }

  // Update OPC items with current simulated values
  async updateOPCItems() {
    try {
      const writePromises = [];
      for (const [tagPath, item] of this.items) {
        const value = this.data[tagPath];
        writePromises.push(item.write(value));
      }
      await Promise.all(writePromises);
    } catch (error) {
      console.error("Error updating OPC items:", error);
    }
  }

  // Get current value of a tag
  getValue(tagPath) {
    return this.data[tagPath];
  }

  // Set value for a writable tag
  async setValue(tagPath, value) {
    if (this.items.has(tagPath)) {
      this.data[tagPath] = value;
      if (this.running) {
        const item = this.items.get(tagPath);
        await item.write(value);
      }
    }
  }

  // Get simulation status
  getStatus() {
    return {
      running: this.running,
      tagCount: this.items.size,
      simulatedTags: Array.from(this.simulationPatterns.keys()),
    };
  }
}

// Create test script
async function runSimulatorTest() {
  const simulator = new PLCSimulator();

  try {
    console.log("Starting PLC Simulator test...");

    // Start simulator
    await simulator.start();
    console.log("Simulator started");

    // Wait for some data to be generated
    console.log("Collecting data for 30 seconds...");
    await new Promise((resolve) => setTimeout(resolve, 30000));

    // Log current values
    console.log("\nCurrent Values:");
    for (const [tagPath, value] of Object.entries(simulator.data)) {
      console.log(`${tagPath}: ${value}`);
    }

    // Test write operation
    const testWriteTag = Object.values(config.tags.write)[0];
    console.log(`\nTesting write to ${testWriteTag}`);
    await simulator.setValue(testWriteTag, 42);
    console.log(`New value: ${simulator.getValue(testWriteTag)}`);

    // Get simulator status
    const status = simulator.getStatus();
    console.log("\nSimulator Status:", status);

    // Stop simulator
    await simulator.stop();
    console.log("Simulator stopped");

    return true;
  } catch (error) {
    console.error("Simulator test failed:", error);
    await simulator.stop();
    return false;
  }
}

// Run test if this is the main module
if (require.main === module) {
  runSimulatorTest()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((error) => {
      console.error("Test failed:", error);
      process.exit(1);
    });
}

export default PLCSimulator;
