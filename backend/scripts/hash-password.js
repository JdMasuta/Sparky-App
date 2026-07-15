#!/usr/bin/env node
// Generate an ADMIN_PASSWORD_HASH value for the admin login.
//
//   node backend/scripts/hash-password.js "my secret password"
//
// Copy the printed line into your .env (SPARKY_DATA_DIR/.env in production).
import { hashPassword } from "../src/services/auth/crypto.js";

const password = process.argv.slice(2).join(" ");
if (!password) {
  console.error('Usage: node backend/scripts/hash-password.js "<password>"');
  process.exit(1);
}

console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
