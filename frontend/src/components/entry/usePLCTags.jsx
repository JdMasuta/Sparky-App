// ../components/entry/usePLCTags.jsx
import { useState } from "react";

export const usePLCTags = () => {
  const [error, setError] = useState(null);

  const tagMappings = {
    name: "_200_GLB.StringData[0]",
    project: "_200_GLB.StringData[1]",
    item: "_200_GLB.StringData[2]",
    stepNumber: "_200_GLB.DintData[2]",
  };

  const stepNumbers = {
    name: 2,
    project: 3,
    item: 4,
  };

  const writeToPLC = async (fieldName, value) => {
    try {
      const nextStep = stepNumbers[fieldName];
      if (!nextStep) {
        return true; // Field doesn't need step number update (e.g., quantity)
      }

      const tags = {
        [tagMappings[fieldName]]: value,
        [tagMappings.stepNumber]: nextStep,
      };

      const response = await fetch("/api/rslinx/batch/write", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tags }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      await response.json();
      return true;
    } catch (error) {
      console.error("Error writing to PLC:", error);
      setError(error.message);
      return false;
    }
  };

  const resetStepInPLC = async () => {
    try {
      const tags = {
        [tagMappings.stepNumber]: 1,
      };

      const response = await fetch("/api/rslinx/batch/write", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tags }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      await response.json();
      setError(null);
      return true;
    } catch (error) {
      console.error("Error resetting PLC step:", error);
      setError(error.message);
      return false;
    }
  };

  const resetPLCvalues = async () => {
    try {
      // Send a POST request to clear string data
      response = await fetch("/api/RSLinx/batch/write", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tags: [
            "_200_GLB.StringData[0]",
            "_200_GLB.StringData[1]",
            "_200_GLB.StringData[2]",
          ],
          values: ["", "", ""],
        }),
        signal: controller.signal, // Use the AbortController signal
      });
      await response.json();
      setError(null);
      return true;
    } catch (error) {
      setError(error.message);
      return false;
    }
  };

  return {
    writeToPLC,
    resetStepInPLC,
    resetPLCvalues,
    error,
  };
};
