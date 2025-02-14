const controllers = require("./controllers");

// Authentication middleware
function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  // Toggle authentication check as needed
  if (false && authHeader !== `Bearer ${controllers.AUTH_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

module.exports = function (app) {
  // Basic Tag Operations
  app.get("/tags/:tagName", verifyAuth, controllers.getTag);
  app.post("/tags/:tagName", verifyAuth, controllers.postTag);

  // Batch Operations
  app.post("/batch/read", verifyAuth, controllers.batchRead);
  app.post("/batch/write", verifyAuth, controllers.batchWrite);

  // Connection Management
  app.get("/status", verifyAuth, controllers.getStatus);
  app.post("/reconnect", verifyAuth, controllers.reconnect);

  // Production Operations: Monitoring the PLC
  app.get("/monitor/:sessionId", verifyAuth, controllers.monitor);
  app.post("/monitor/stop", verifyAuth, controllers.stopMonitor);

  // WebSocket Endpoint
  app.ws("/ws", controllers.wsHandler);
};
