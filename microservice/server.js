const express = require("express");
const bodyParser = require("body-parser");
const expressWs = require("express-ws");
const routes = require("./routes");

process.on("uncaughtException", (err) => {
  console.error("Caught unhandled exception:", err);
  // Optionally, you might decide to restart the process or log the error without exiting
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

const app = express();
expressWs(app); // enable WebSocket support

app.use(bodyParser.json());

// Load all routes
routes(app);

// ------------------ START THE SERVER ------------------
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`PLClink service running on port ${PORT}`);
});
