// backend/src/services/controllers/utilitiesController.js
import { exec } from "child_process";
import { promises as fs } from "fs";
import { securityConfig } from "../config/server.config.js";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the repository base path (up 4 levels from the controller file)
const repoPath = path.resolve(__dirname, "../../../..");

// Execute git command and return the result
const executeGitCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, { cwd: repoPath }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Git command error: ${error.message}`);
        return reject({
          success: false,
          message: "Git command failed",
          error: error.message,
        });
      }

      if (stderr && !stderr.includes("Already up to date")) {
        console.warn(`Git stderr: ${stderr}`);
      }

      resolve({
        success: true,
        message: "Git command executed successfully",
        output: stdout,
        warnings: stderr,
      });
    });
  });
};

// Git pull controller
export const gitPull = async (req, res, next) => {
  try {
    // Log the git pull request
    const logMessage = `${new Date().toISOString()} Git pull requested by ${
      req.user || "unknown"
    }\n`;
    console.log(logMessage.trim());

    const result = await executeGitCommand("git pull");

    // Log the result
    const resultLog = `${new Date().toISOString()} Git pull result: ${JSON.stringify(
      result
    )}\n`;
    console.log(resultLog.trim());

    return res.status(200).json(result);
  } catch (error) {
    console.error(`Error executing git pull: ${error}`);
    next(error);
  }
};

// Git status controller
export const gitStatus = async (req, res, next) => {
  try {
    const result = await executeGitCommand("git status");
    return res.status(200).json(result);
  } catch (error) {
    console.error(`Error executing git status: ${error}`);
    next(error);
  }
};
