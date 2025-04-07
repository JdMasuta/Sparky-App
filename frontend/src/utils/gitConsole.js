// frontend/src/utils/gitConsole.js
/**
 * GitConsole - A utility for executing git commands from the browser console
 *
 * Usage:
 * 1. Set your API key: GitConsole.setApiKey('your-secure-api-key')
 * 2. Pull the latest code: GitConsole.pull()
 * 3. Check git status: GitConsole.status()
 */

const GitConsole = (function () {
  let apiKey = "";
  const API_BASE = "/api/utilities/git";

  // Store API key (only in memory, never persisted)
  const setApiKey = (key) => {
    apiKey = key;
    console.log("API key set successfully");
  };

  // Execute a git pull operation
  const pull = async () => {
    if (!apiKey) {
      console.error(
        "API key not set. Call GitConsole.setApiKey(yourKey) first."
      );
      return;
    }

    try {
      console.log("Executing git pull...");
      const response = await fetch(`${API_BASE}/pull`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
      });

      const result = await response.json();

      if (result.success) {
        console.log(
          "%c Git pull successful!",
          "color: green; font-weight: bold;"
        );
        console.log(result.output);
        if (result.warnings) {
          console.warn("%c Git warnings:", "color: orange;");
          console.warn(result.warnings);
        }
      } else {
        console.error("Git pull failed:", result.message);
        if (result.error) {
          console.error(result.error);
        }
      }

      return result;
    } catch (error) {
      console.error("Error executing git pull:", error);
    }
  };

  // Get the current git status
  const status = async () => {
    if (!apiKey) {
      console.error(
        "API key not set. Call GitConsole.setApiKey(yourKey) first."
      );
      return;
    }

    try {
      console.log("Fetching git status...");
      const response = await fetch(`${API_BASE}/status`, {
        method: "GET",
        headers: {
          "X-API-Key": apiKey,
        },
      });

      const result = await response.json();

      if (result.success) {
        console.log("%c Git status:", "color: blue; font-weight: bold;");
        console.log(result.output);
      } else {
        console.error("Failed to get git status:", result.message);
        if (result.error) {
          console.error(result.error);
        }
      }

      return result;
    } catch (error) {
      console.error("Error fetching git status:", error);
    }
  };

  // Expose the public methods
  return {
    setApiKey,
    pull,
    status,
  };
})();

// Make GitConsole available globally
window.GitConsole = GitConsole;

export default GitConsole;
