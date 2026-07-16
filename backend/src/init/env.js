// Environment bootstrap. Import this FIRST (before any config module) so that
// process.env is populated before config files read it.
//
// Precedence (highest wins; dotenv never overrides an already-set var):
//   1. real OS environment           (e.g. vars exported by the launcher)
//   2. $SPARKY_DATA_DIR/.env          (production secrets, outside the release tree)
//   3. backend/.env                   (local development; may itself define SPARKY_DATA_DIR)
//
// SPARKY_DATA_DIR may be set either in the OS environment or in backend/.env. To
// resolve that chicken-and-egg we pre-parse backend/.env (without mutating the
// environment) purely to discover SPARKY_DATA_DIR, then load the two files in
// precedence order.
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../"); // backend/
const backendEnv = path.join(backendRoot, ".env");

let dataDir = process.env.SPARKY_DATA_DIR;
if (!dataDir && fs.existsSync(backendEnv)) {
  try {
    dataDir = dotenv.parse(fs.readFileSync(backendEnv)).SPARKY_DATA_DIR;
  } catch {
    /* ignore malformed .env */
  }
}

// data-dir .env first so its secrets win over backend/.env (dotenv keeps the
// first value set for a key). The OS environment still wins over both.
if (dataDir) dotenv.config({ path: path.join(dataDir, ".env") });
dotenv.config({ path: backendEnv });
