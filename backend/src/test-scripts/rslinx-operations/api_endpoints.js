// REQUIRES ADDITIONAL LIBRARIES: mocha, chai, supertest

import request from "supertest";
import { expect } from "chai";
import app from "../app.js"; // Your Express app
import config from "../../services/config/rslinx.config.js";

describe("RSLinx OPC DA API Tests", function () {
  this.timeout(10000); // Increase timeout for OPC operations

  // Test connection status endpoint
  describe("GET /api/rslinx/status", () => {
    it("should return connection status", async () => {
      const response = await request(app)
        .get("/api/rslinx/status")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).to.have.property("connected");
      expect(response.body).to.have.property("serverName");
      expect(response.body).to.have.property("groupName");
    });
  });

  // Test getting all tags
  describe("GET /api/rslinx/tags", () => {
    it("should return all configured tags", async () => {
      const response = await request(app)
        .get("/api/rslinx/tags")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).to.have.property("read");
      expect(response.body).to.have.property("write");
      expect(response.body.read).to.deep.equal(config.tags.read);
      expect(response.body.write).to.deep.equal(config.tags.write);
    });
  });

  // Test reading a single tag
  describe("GET /api/rslinx/tags/:tagName", () => {
    it("should read a valid tag value", async () => {
      const testTag = Object.keys(config.tags.read)[0];
      const response = await request(app)
        .get(`/api/rslinx/tags/${testTag}`)
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).to.have.property("tagName", testTag);
      expect(response.body).to.have.property("value");
      expect(response.body).to.have.property("timestamp");
      expect(response.body).to.have.property("quality");
    });

    it("should return 404 for non-existent tag", async () => {
      await request(app).get("/api/rslinx/tags/nonexistenttag").expect(404);
    });
  });

  // Test writing to a tag
  describe("POST /api/rslinx/tags/:tagName", () => {
    it("should write to a valid tag", async () => {
      const testTag = Object.keys(config.tags.write)[0];
      const testValue = 42; // Adjust based on tag type

      const response = await request(app)
        .post(`/api/rslinx/tags/${testTag}`)
        .send({ value: testValue })
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).to.have.property("success", true);
    });

    it("should return 404 for non-writable tag", async () => {
      const readOnlyTag = Object.keys(config.tags.read)[0];
      await request(app)
        .post(`/api/rslinx/tags/${readOnlyTag}`)
        .send({ value: 42 })
        .expect(404);
    });
  });

  // Test batch read
  describe("POST /api/rslinx/batch/read", () => {
    it("should read multiple tags", async () => {
      const testTags = Object.keys(config.tags.read).slice(0, 2);

      const response = await request(app)
        .post("/api/rslinx/batch/read")
        .send({ tags: testTags })
        .expect("Content-Type", /json/)
        .expect(200);

      testTags.forEach((tag) => {
        expect(response.body).to.have.property(tag);
        expect(response.body[tag]).to.have.property("value");
        expect(response.body[tag]).to.have.property("quality");
        expect(response.body[tag]).to.have.property("timestamp");
      });
    });
  });

  // Test batch write
  describe("POST /api/rslinx/batch/write", () => {
    it("should write to multiple tags", async () => {
      const testTags = Object.keys(config.tags.write).slice(0, 2);
      const writeValues = {};
      testTags.forEach((tag) => {
        writeValues[tag] = 42; // Adjust based on tag types
      });

      const response = await request(app)
        .post("/api/rslinx/batch/write")
        .send({ tags: writeValues })
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).to.have.property("success", true);
    });
  });

  // Test reconnection
  describe("POST /api/rslinx/reconnect", () => {
    it("should reconnect to the server", async () => {
      const response = await request(app)
        .post("/api/rslinx/reconnect")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).to.have.property("success", true);
    });
  });

  // Test tag validation
  describe("GET /api/rslinx/validate/:tagName", () => {
    it("should validate existing tag", async () => {
      const testTag = Object.keys(config.tags.read)[0];

      const response = await request(app)
        .get(`/api/rslinx/validate/${testTag}`)
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).to.have.property("valid");
      expect(response.body).to.have.property("quality");
      expect(response.body).to.have.property("readable");
    });
  });
});
