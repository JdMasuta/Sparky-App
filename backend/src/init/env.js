// Environment bootstrap. Import this FIRST (before any config module) so that
// process.env is populated before config files read it.
//
// Load order (later loads never override already-set vars, so precedence is):
//   1. real OS environment (highest — e.g. vars exported by setup.bat)
//   2. $SPARKY_DATA_DIR/.env   (production secrets, outside the release tree)
//   3. backend/.env           (local development fallback)
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../"); // backend/

if (process.env.SPARKY_DATA_DIR) {
  dotenv.config({ path: path.join(process.env.SPARKY_DATA_DIR, ".env") });
}
dotenv.config({ path: path.join(backendRoot, ".env") });
