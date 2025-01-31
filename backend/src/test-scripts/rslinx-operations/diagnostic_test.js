import opcda from "node-opc-da";
import config from "./rslinx.config.js";

async function diagnosticTest() {
  let server = null;
  let group = null;

  try {
    console.log("Starting RSLinx diagnostic test...");
    console.log("Configuration:", {
      progId: config.progId,
      clsid: config.clsid,
      groupName: config.groupName,
    });

    // Test DCOM connectivity
    console.log("\nTesting DCOM connectivity...");
    const client = new opcda.Client();

    // Enumerate available servers (this helps verify DCOM/RSLinx visibility)
    console.log("\nEnumerating available OPC servers...");
    const servers = await client.listServers();
    console.log("Available servers:", servers);

    // Attempt server connection with detailed error handling
    console.log("\nAttempting server connection...");
    server = await client
      .connectServer({
        progId: config.progId,
        clsid: config.clsid,
      })
      .catch((err) => {
        throw new Error(
          `Server connection failed: ${err.message}\nVerify RSLinx is running and DCOM permissions are correct`
        );
      });

    console.log("Server connected successfully");
    console.log("Server details:", {
      name: server.name,
      status: server.status,
      vendorInfo: server.vendorInfo,
    });

    // Test group creation
    console.log("\nAttempting group creation...");
    group = await server
      .addGroup({
        name: config.groupName,
        updateRate: config.updateRate,
        deadband: config.deadband,
      })
      .catch((err) => {
        throw new Error(`Group creation failed: ${err.message}`);
      });

    console.log("Group created successfully:", {
      name: group.name,
      updateRate: group.updateRate,
    });

    // Test tag reading if tags are configured
    if (Object.keys(config.tags.read || {}).length > 0) {
      const testTag = Object.values(config.tags.read)[0];
      console.log("\nTesting tag read with:", testTag);

      const item = await group.addItem({
        itemID: testTag,
        active: true,
      });

      const value = await item.read();
      console.log("Tag read successful:", value);
      await item.remove();
    }

    return true;
  } catch (error) {
    console.error("\nDiagnostic test failed:", error.message);
    if (error.code) {
      console.error("Error code:", error.code);
    }
    return false;
  } finally {
    // Cleanup
    try {
      if (group) await group.remove();
      if (server) await server.disconnect();
      console.log("\nCleanup completed");
    } catch (cleanupError) {
      console.error("Cleanup error:", cleanupError.message);
    }
  }
}

export default diagnosticTest;
