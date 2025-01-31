import opcda from "node-opc-da";
import config from "../../services/config/rslinx.config.js";

async function validateTags() {
  let server = null;
  let group = null;
  const results = {
    valid: [],
    invalid: [],
    summary: {
      total: 0,
      valid: 0,
      invalid: 0,
    },
  };

  try {
    console.log("Validating Tag Configuration...");
    console.log("--------------------------------");

    // Connect to server
    const client = new opcda.Client();
    server = await client.connectServer({
      progId: config.progId,
      clsid: config.clsid,
    });

    // Create test group
    group = await server.addGroup({
      name: "ValidationGroup",
      updateRate: 1000,
      deadband: 0,
    });

    // Combine read and write tags
    const allTags = {
      ...config.tags.read,
      ...config.tags.write,
    };

    // Test each tag
    for (const [tagName, tagPath] of Object.entries(allTags)) {
      try {
        console.log(`Testing tag: ${tagName} (${tagPath})`);

        // Try to add item
        const item = await group.addItem({
          itemID: tagPath,
          active: true,
        });

        // Try to read
        const value = await item.read();

        // Check quality
        if (value.quality === "GOOD") {
          results.valid.push({
            name: tagName,
            path: tagPath,
            dataType: value.value !== null ? typeof value.value : "unknown",
            quality: value.quality,
          });
          console.log(`✓ Tag "${tagName}" is valid`);
        } else {
          results.invalid.push({
            name: tagName,
            path: tagPath,
            error: `Poor quality: ${value.quality}`,
          });
          console.log(
            `✗ Tag "${tagName}" has quality issues: ${value.quality}`
          );
        }

        // Clean up
        await item.remove();
      } catch (error) {
        results.invalid.push({
          name: tagName,
          path: tagPath,
          error: error.message,
        });
        console.log(`✗ Tag "${tagName}" is invalid: ${error.message}`);
      }
    }

    // Generate summary
    results.summary.total = Object.keys(allTags).length;
    results.summary.valid = results.valid.length;
    results.summary.invalid = results.invalid.length;

    // Print summary
    console.log("\nValidation Summary:");
    console.log("--------------------------------");
    console.log(`Total tags: ${results.summary.total}`);
    console.log(`Valid tags: ${results.summary.valid}`);
    console.log(`Invalid tags: ${results.summary.invalid}`);

    // Clean up
    await group.remove();
    await server.disconnect();

    return results;
  } catch (error) {
    console.error("Validation failed:", error.message);
    throw error;
  } finally {
    try {
      if (group) await group.remove();
      if (server) await server.disconnect();
    } catch (error) {
      console.error("Cleanup failed:", error.message);
    }
  }
}

if (require.main === module) {
  validateTags()
    .then((results) => {
      console.log("\nDetailed Results:", JSON.stringify(results, null, 2));
      process.exit(results.summary.invalid === 0 ? 0 : 1);
    })
    .catch((error) => {
      console.error("Validation failed:", error);
      process.exit(1);
    });
}

export default validateTags;
