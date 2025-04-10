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

    const result = await executeGitCommand("git pull origin main");

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

// Python execute controller
export const pyExecute = async (req, res, next) => {
  try {
    const { command } = req.body;
    if (!command) {
      return res.status(400).json({
        success: false,
        message: "No code provided",
      });
    }

    // Create a temporary Python file
    const tempFilePath = path.join(repoPath, "temp_script.py");
    await fs.writeFile(tempFilePath, command);

    // Execute the Python script
    exec(`python3 ${tempFilePath}`, (error, stdout, stderr) => {
      // Clean up the temporary file
      fs.unlink(tempFilePath).catch((err) =>
        console.error(`Error deleting temp file: ${err}`)
      );

      if (error) {
        console.error(`Python execution error: ${error.message}`);
        return res.status(500).json({
          success: false,
          message: "Python execution failed",
          error: error.message,
        });
      }

      if (stderr) {
        console.warn(`Python stderr: ${stderr}`);
      }

      return res.status(200).json({
        success: true,
        message: "Python script executed successfully",
        output: stdout,
        warnings: stderr,
      });
    });
  } catch (error) {
    console.error(`Error executing Python script: ${error}`);
    next(error);
  }
};

// PowerShell execute controller
export const pwshExecute = async (req, res, next) => {
  try {
    const { command } = req.body;
    if (!command) {
      return res.status(400).json({
        success: false,
        message: "No code provided",
      });
    }

    // Execute the PowerShell script
    exec(`${command}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`PowerShell execution error: ${error.message}`);
        return res.status(500).json({
          success: false,
          message: "PowerShell execution failed",
          error: error.message,
        });
      }

      if (stderr) {
        console.warn(`PowerShell stderr: ${stderr}`);
      }

      return res.status(200).json({
        success: true,
        message: "PowerShell script executed successfully",
        output: stdout,
        warnings: stderr,
      });
    });
  } catch (error) {
    console.error(`Error executing PowerShell script: ${error}`);
    next(error);
  }
};
