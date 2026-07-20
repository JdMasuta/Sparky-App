// Environment bootstrap. Import this FIRST (before config.js) so that
// process.env is populated before the module-level config object reads it.
//
// Precedence (highest wins; dotenv never overrides an already-set var):
//   1. real OS environment       (e.g. vars exported by sparky.bat)
//   2. <SPARKY_DATA_DIR>/microservice.env
//
// SPARKY_DATA_DIR itself is expected to already be set in the OS environment
// (sparky.bat exports it, defaulting to <repo>\data, before launching node);
// for standalone runs that bypass sparky.bat, default to the same location.
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const microserviceRoot = path.resolve(__dirname, "../../"); // microservice/

const dataDir = process.env.SPARKY_DATA_DIR
  ? path.resolve(process.env.SPARKY_DATA_DIR)
  : path.resolve(microserviceRoot, "..", "data"); // repo/data — same default sparky.bat uses

dotenv.config({ path: path.join(dataDir, "microservice.env") });
