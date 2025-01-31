// backend/src/config/db.config.js
import path from "path";
import { serverConfig } from "./server.config.js";

const env = process.env.NODE_ENV || "development";

const config = {
  development: {
    filename: path.join(serverConfig.paths.database, "dev.sqlite"),
    maxConnections: 10,
    timeout: 5000,
    verbose: false,
  },

  test: {
    filename: path.join(serverConfig.paths.database, "test.sqlite"),
    maxConnections: 5,
    timeout: 2000,
    verbose: false,
  },

  production: {
    filename: path.join(serverConfig.paths.database, "prod.sqlite"),
    maxConnections: 20,
    timeout: 10000,
    verbose: false,
  },
};

export default config[env];
