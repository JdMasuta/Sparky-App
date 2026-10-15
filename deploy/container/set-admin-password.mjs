// One-off helper (#25): change the admin password in the data volume. Runs in
// the app image with sparky-data at /data (see sparky-docker.bat
// set-admin-password). Reads the new password from stdin, never from argv
// (argv is visible in the process list), and stores only its scrypt hash.
// Restart the app container afterwards so the backend picks it up.
import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { hashPassword } from "../../backend/src/services/auth/crypto.js";

/** Replace (or append) ADMIN_PASSWORD_HASH in an env file's text. */
export function setHashLine(text, hash) {
  const line = `ADMIN_PASSWORD_HASH=${hash}`;
  const re = /^ADMIN_PASSWORD_HASH=.*$/m;
  if (re.test(text)) return text.replace(re, line);
  return `${text.replace(/\s*$/, "\n")}${line}\n`;
}

/** Atomically write the new hash into `envFile`. */
export async function setAdminPassword(envFile, password) {
  if (!password || password.length < 8) throw new Error("The password must be at least 8 characters");
  const text = await fs.readFile(envFile, "utf8");
  const tmp = path.join(path.dirname(envFile), `.backend.env.${process.pid}.tmp`);
  await fs.writeFile(tmp, setHashLine(text, hashPassword(password)), { mode: 0o600 });
  await fs.rename(tmp, envFile);
}

async function readPassword(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  if (process.stdin.isTTY) {
    // Hide typed characters.
    rl._writeToOutput = (s) => {
      if (s.includes(prompt)) process.stdout.write(prompt);
    };
  }
  const answer = await new Promise((resolve) => rl.question(prompt, resolve));
  rl.close();
  if (process.stdin.isTTY) process.stdout.write("\n");
  return answer;
}

if (process.argv[1] && process.argv[1].endsWith("set-admin-password.mjs")) {
  const envFile = path.join(process.env.SPARKY_DATA_DIR || "/data", "backend.env");
  try {
    const password = await readPassword("New admin password: ");
    if (process.stdin.isTTY && (await readPassword("Repeat password: ")) !== password) {
      throw new Error("Passwords do not match");
    }
    await setAdminPassword(envFile, password);
    console.log("Admin password updated. Restart the app container to apply it.");
  } catch (err) {
    console.error(`Failed: ${err.message}`);
    process.exit(1);
  }
}
