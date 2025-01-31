import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DDEClient {
  constructor() {
    this.pythonScript = join(__dirname, "dde_bridge.py");
  }

  parseDDELink(link) {
    // Parse Excel DDE link format: [ExcelLink]_200_GLB.DintData[2],L1,C1
    const match = link.match(/\[([^\]]+)\]([^,]+),([^,]+),([^,]+)/);
    if (!match) {
      throw new Error("Invalid DDE link format");
    }

    return {
      application: "RSLinx", // The actual DDE server name
      topic: match[1], // ExcelLink
      item: match[2], // _200_GLB.DintData[2]
      row: match[3], // L1
      column: match[4], // C1
    };
  }

  async readTag(ddeLink) {
    return new Promise((resolve, reject) => {
      try {
        // Parse the DDE link before sending to Python
        const parsedLink = this.parseDDELink(ddeLink);
        const python = spawn("python", [
          this.pythonScript,
          JSON.stringify(parsedLink),
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
            if (result.error) {
              reject(new Error(result.error));
            } else {
              resolve(result.value);
            }
          } catch (e) {
            reject(new Error("Failed to parse Python output"));
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }
}

// Usage example with the specific DDE link:
const main = async () => {
  const dde = new DDEClient();
  const testTag = "[ExcelLink]_200_GLB.DintData[2],L1,C1";

  try {
    console.log("Parsing DDE link:", testTag);
    const parsedLink = dde.parseDDELink(testTag);
    console.log("Parsed structure:", parsedLink);

    console.log("\nAttempting to read tag...");
    const value = await dde.readTag(testTag);
    console.log("Tag value:", value);
  } catch (error) {
    console.error("Error:", error.message);
  }
};

// Only run if this is the main module
if (import.meta.url === new URL(import.meta.url).href) {
  main();
}
