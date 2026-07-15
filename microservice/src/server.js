import express from "express";
import cors from "cors";
import { config, isSim } from "./config.js";
import { bridgeAuth } from "./auth.js";
import { buildRoutes } from "./routes.js";
import { SimDriver } from "./driver/simDriver.js";
import { EthernetIpDriver } from "./driver/ethernetIpDriver.js";

export function createDriver() {
  return isSim() ? new SimDriver(config) : new EthernetIpDriver(config);
}

export function createApp(driver) {
  const app = express();
  app.use(cors({ origin: false })); // loopback-only; no cross-origin needed
  app.use(express.json());
  app.use(bridgeAuth);
  app.use(buildRoutes(driver));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("Bridge error:", err.message);
    res.status(502).json({ error: "PLC operation failed", message: err.message });
  });

  return app;
}

// Start only when run directly (not when imported by tests).
const isMain = process.argv[1] && process.argv[1].endsWith("server.js");
if (isMain) {
  const driver = createDriver();
  driver
    .connect()
    .catch((err) => console.error("Initial PLC connect failed:", err.message));

  const app = createApp(driver);
  app.listen(config.port, config.host, () => {
    console.log(
      `PLC bridge (${config.mode}) listening on http://${config.host}:${config.port}`
    );
    if (config.host !== "127.0.0.1" && config.host !== "localhost") {
      console.warn(
        `WARNING: bridge bound to ${config.host} — it should normally be loopback-only.`
      );
    }
  });
}
