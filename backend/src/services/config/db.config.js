// backend/src/config/db.config.js
import path from "path";
import { serverConfig } from "./server.config.js";

const env = process.env.NODE_ENV || "development";

// DB file name per environment. Override with SPARKY_DB_FILE (a bare filename)
// if you need a non-default name. The directory always comes from
// SPARKY_DATA_DIR (serverConfig.paths.database).
const DEFAULT_FILE = { development: "dev.sqlite", test: "test.sqlite", production: "prod.sqlite" };
const fileName = process.env.SPARKY_DB_FILE || DEFAULT_FILE[env] || "dev.sqlite";

const config = {
  development: { maxConnections: 10, timeout: 5000, verbose: false },
  test: { maxConnections: 5, timeout: 2000, verbose: false },
  production: { maxConnections: 20, timeout: 10000, verbose: false },
};

export default {
  ...(config[env] || config.development),
  filename: path.join(serverConfig.paths.database, fileName),
};
