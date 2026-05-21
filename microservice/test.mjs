import { PLC, CIPDataType } from "ethernet-ip";

async function test() {
  console.log("Testing read:");
  const plc = new PLC();
  await plc.connect("192.168.1.70");
  const tagData = await plc.read("_200_GLB.Description");
  console.log(tagData);
}

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
    await plc.connect("192.168.1.70");
    for (let i = 0; i < Object.keys(TAGS).length; i++) {
      const tag = Object.values(TAGS)[i];
      plc.registry.define(tag.name, tag.type);
    }
    return plc;
  } catch (error) {
    console.error("Error connecting to PLC:", error);
    throw error;
  }
}

async function readTags(tags) {
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

async function writeTags(tagData) {
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

async function getTag(tagName) {
  const tag = getTagFromName(tagName);
  return await readTags([tag.name]);
}

async function postTag(tagName, value) {
  const tag = getTagFromName(tagName);
  return await writeTags([{ name: tag.name, data: value }]);
}

async function batchRead(tagNames) {}

async function batchWrite(tagData) {}

async function getStatus() {}

async function monitor() {}

// console.log(await getTag("test"));
// console.log(await getTag("testWrite"));
// console.log(await postTag("testWrite", 5678));
// console.log(await getTag("testWrite"));

async function testGetTagAPI() {
  try {
    const response = await fetch("http://localhost:8000/tags/testWrite", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        // Authorization: `Bearer ${controllers.AUTH_TOKEN}`,
      },
    });
    const data = await response.json();
    console.log("API Response:", data);
  } catch (error) {
    console.error("Error testing API:", error);
  }
}

async function testPostTagAPI(number = 0) {
  try {
    const response = await fetch("http://localhost:8000/tags/testWrite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Authorization: `Bearer ${controllers.AUTH_TOKEN}`,
      },
      body: JSON.stringify({ value: number }),
    });
    const data = await response.json();
    console.log("API Response:", data);
  } catch (error) {
    console.error("Error testing API:", error);
  }
}

async function testGetBatchAPI() {
  try {
    const response = await fetch("http://localhost:8000/batch/read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Authorization: `Bearer ${controllers.AUTH_TOKEN}`,
      },
      body: JSON.stringify({ tags: ["test", "testWrite", "testWrite2"] }),
    });
    const data = await response.json();
    console.log("API Response:", data);
  } catch (error) {
    console.error("Error testing API:", error);
  }
}

async function testPostBatchAPI() {
  try {
    const response = await fetch("http://localhost:8000/batch/write", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Authorization: `Bearer ${controllers.AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        tags: [
          { name: "testWrite", data: 1234 },
          { name: "testWrite2", data: 5678 },
        ],
      }),
    });
    const data = await response.json();
    console.log("API Response:", data);
  } catch (error) {
    console.error("Error testing API:", error);
  }
}

async function testGetStatusAPI() {
  try {
    const response = await fetch("http://localhost:8000/status", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        // Authorization: `Bearer ${controllers.AUTH_TOKEN}`,
      },
    });
    const data = await response.json();
    console.log("API Response:", data);
  } catch (error) {
    console.error("Error testing API:", error);
  }
}

async function testMonitorAPI() {
  try {
    const response = await fetch("http://localhost:8000/monitor/session123", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        // Authorization: `Bearer ${controllers.AUTH_TOKEN}`,
      },
    });
    const data = await response.json();
    console.log("API Response:", data);
  } catch (error) {
    console.error("Error testing API Start:", error);
  }
  await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for 2 seconds to simulate monitoring
  try {
    const response = await fetch("http://localhost:8000/monitor/stop", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Authorization: `Bearer ${controllers.AUTH_TOKEN}`,
      },
      body: JSON.stringify({ sessionId: "session123" }),
    });
    const data = await response.json();
    console.log("API Response:", data);
  } catch (error) {
    console.error("Error testing API Stop:", error);
  }
}

console.log("Starting API tests...");
console.log("getTag()");
await testGetTagAPI();
console.log("postTag()");
await testPostTagAPI(1234);
console.log("getTag()");
await testGetTagAPI();
console.log("postTag()");
await testPostTagAPI();
console.log("getBatch()");
await testGetBatchAPI();
console.log("postBatch()");
await testPostBatchAPI();
console.log("getBatch()");
await testGetBatchAPI();
console.log("getStatus()");
await testGetStatusAPI();
console.log("monitor()");
await testMonitorAPI();

// module.exports = {
//   AUTH_TOKEN,
//   getTag,
//   postTag,
//   batchRead,
//   batchWrite,
//   getStatus,
//   reconnect,
//   monitor,
//   stopMonitor,
//   wsHandler,
// };
