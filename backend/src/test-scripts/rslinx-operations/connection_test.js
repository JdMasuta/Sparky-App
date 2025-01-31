import opcda from "node-opc-da";
import config from "../../services/config/rslinx.config.js";

async function testOPCDAConnection() {
  let server = null;
  let group = null;

  try {
    console.log("Testing OPC DA Connection...");
    console.log("--------------------------------");

    // Create client
    const client = new opcda.Client();
    console.log("✓ Client created");

    // Test server connection
    server = await client.connectServer({
      progId: config.progId,
      clsid: config.clsid,
    });
    console.log("✓ Server connected successfully");
    console.log(`  Server name: ${server.name}`);
    console.log(`  Server status: ${server.status}`);

    // Test group creation
    group = await server.addGroup({
      name: config.groupName,
      updateRate: config.updateRate,
      deadband: config.deadband,
    });
    console.log("✓ Group created successfully");
    console.log(`  Group name: ${group.name}`);
    console.log(`  Update rate: ${group.updateRate}ms`);

    // Basic read/write test with a test tag
    const testTag = Object.values(config.tags.write)[0]; // Get first writable tag
    const testItem = await group.addItem({
      itemID: testTag,
      active: true,
    });
    console.log("✓ Test item added successfully");

    // Try to read
    const readValue = await testItem.read();
    console.log("✓ Read operation successful");
    console.log(`  Value: ${readValue.value}`);
    console.log(`  Quality: ${readValue.quality}`);
    console.log(`  Timestamp: ${readValue.timestamp}`);

    // Clean up
    await testItem.remove();
    await group.remove();
    await server.disconnect();
    console.log("✓ Cleanup successful");
    console.log("--------------------------------");
    console.log("All connection tests passed!");

    return true;
  } catch (error) {
    console.error("Connection test failed:", error.message);

    // Attempt cleanup
    try {
      if (group) await group.remove();
      if (server) await server.disconnect();
    } catch (cleanupError) {
      console.error("Cleanup failed:", cleanupError.message);
    }

    return false;
  }
}

if (require.main === module) {
  testOPCDAConnection()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((error) => {
      console.error("Test failed:", error);
      process.exit(1);
    });
}

export default testOPCDAConnection;
