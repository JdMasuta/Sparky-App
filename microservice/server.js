const express = require("express");
const cors = require("cors");
const expressWs = require("express-ws");
const routes = require("./routes");

// Simple custom logger middleware
const myLogger = (req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  console.log("");

  // CRITICAL: call next() to prevent the request from hanging
  next();
};

process.on("uncaughtException", (err) => {
  console.error("Caught unhandled exception:", err);
  // Optionally, you might decide to restart the process or log the error without exiting
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

const app = express();
expressWs(app); // enable WebSocket support

// app.use(bodyParser.json());
app.use(express.json()); // Built-in body parser for JSON
app.use(cors()); // Enable CORS for all routes
app.use(myLogger); // Use the custom logger middleware

// Load all routes
routes(app);

// ------------------ START THE SERVER ------------------\

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`PLClink service running on port ${PORT}`);
});
