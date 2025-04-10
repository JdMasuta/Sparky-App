/**
 * Command - A utility for executing commands from the browser console
 *
 * Usage:
 * 1: Set your API key: command.setApiKey('your-secure-api-key')
 * 2: Execute a command: command.execute(type, 'your-command')
 */

const Command = (function () {
  let apiKey = "";
  const API_BASE = "/api/utilities/exe";

  // Store API key (only in memory, never persisted)
  const setApiKey = (key) => {
    apiKey = key;
    console.log("API key set successfully");
  };

  // Execute a command (python or pwsh)
  const execute = async (type, command) => {
    if (!apiKey) {
      console.error("API key not set. Call command.setApiKey(yourKey) first.");
      return;
    }

    if (!command) {
      console.error(
        "No command provided. Please provide a command to execute."
      );
      return;
    }

    if (!["python", "pwsh"].includes(type)) {
      console.error("Invalid command type. Use 'python' or 'pwsh'.");
      return;
    }

    try {
      let response;

      if (type === "python") {
        console.log("Executing Python command...");
        response = await fetch(`${API_BASE}/python`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify({ command }),
        });
      } else if (type === "pwsh") {
        console.log("Executing PowerShell command...");
        response = await fetch(`${API_BASE}/pwsh`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify({ command }),
        });
      }

      const result = await response.json();

      if (result.success) {
        console.log(
          `%c ${type} command successful!`,
          "color: green; font-weight: bold;"
        );
        console.log(result.output);
        if (result.warnings) {
          console.warn("%c Command warnings:", "color: orange;");
          console.warn(result.warnings);
        }
      } else {
        console.error(`${type} command failed:`, result.message);
        if (result.error) {
          console.error(result.error);
        }
      }

      return result;
    } catch (error) {
      console.error(`Error executing ${type} command:`, error);
    }
  };

  // Expose the public methods
  return {
    setApiKey,
    execute,
  };
})();

// Make the Command object available globally
window.command = Command;

export default Command;
