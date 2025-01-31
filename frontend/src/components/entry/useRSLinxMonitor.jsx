import { useState, useRef } from "react";

export const useRSLinxMonitor = () => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [error, setError] = useState(null);
  // Use a ref to store an array of active session IDs
  const sessionIdsRef = useRef([]);

  const checkConnection = async () => {
    try {
      const response = await fetch("/api/RSLinx/status");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error checking connection:", error);
      return { ok: false, message: error.message };
    }
  };

  const startMonitoring = async (onQuantityReceived) => {
    const sessionId = `session-${Date.now()}`;
    // Add the new sessionId to the array
    sessionIdsRef.current.push(sessionId);
    setIsMonitoring(true);
    setError(null);

    try {
      console.log("Starting monitoring session:", sessionId);
      const response = await fetch(`/api/rslinx/monitor/${sessionId}`, {
        method: "GET",
      });

      const data = await response.json();
      if (data.success) {
        await onQuantityReceived(data.finalQuantity);
      } else if (data.aborted) {
        console.log(
          `Monitoring session ${sessionId} was aborted by the client.`
        );
      } else {
        console.error(
          `Monitoring session ${sessionId} did not complete successfully:`,
          data
        );
      }
    } catch (err) {
      console.error(`Error starting monitoring session ${sessionId}:`, err);
      setError(err.message);
    } finally {
      // Remove the sessionId from the array once monitoring is done
      sessionIdsRef.current = sessionIdsRef.current.filter(
        (id) => id !== sessionId
      );
      // Update isMonitoring based on whether there are still active sessions
      setIsMonitoring(sessionIdsRef.current.length > 0);
    }
  };

  const stopMonitoring = async (sessionId) => {
    if (!sessionId) {
      console.warn("No sessionId provided to stop monitoring.");
      return;
    }

    if (!sessionIdsRef.current.includes(sessionId)) {
      console.warn(`No active monitoring session with sessionId: ${sessionId}`);
      return;
    }

    try {
      console.log("Stopping monitoring session:", sessionId);
      const response = await fetch("/api/rslinx/monitor/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      const data = await response.json();
      if (data.success) {
        console.log(`Monitoring session ${sessionId} stopped successfully.`);
        // Remove the sessionId from the array
        sessionIdsRef.current = sessionIdsRef.current.filter(
          (id) => id !== sessionId
        );
      } else {
        console.error(
          `Failed to stop monitoring session ${sessionId}:`,
          data.error
        );
      }
    } catch (err) {
      console.error(`Error stopping monitoring session ${sessionId}:`, err);
      setError(err.message);
    } finally {
      // Update isMonitoring based on whether there are still active sessions
      setIsMonitoring(sessionIdsRef.current.length > 0);
    }
  };

  const stopAllMonitoring = async () => {
    if (sessionIdsRef.current.length === 0) {
      console.warn("No active monitoring sessions to stop.");
      return;
    }

    // Create a copy of the session IDs to avoid mutation issues during iteration
    const sessionsToStop = [...sessionIdsRef.current];

    try {
      // Use Promise.all to stop all sessions concurrently
      await Promise.all(
        sessionsToStop.map(async (sessionId) => {
          try {
            console.log("Stopping monitoring session:", sessionId);
            const response = await fetch("/api/rslinx/monitor/stop", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId }),
            });

            const data = await response.json();
            if (data.success) {
              console.log(
                `Monitoring session ${sessionId} stopped successfully.`
              );
              // Remove the sessionId from the array
              sessionIdsRef.current = sessionIdsRef.current.filter(
                (id) => id !== sessionId
              );
            } else {
              console.error(
                `Failed to stop monitoring session ${sessionId}:`,
                data.error
              );
            }
          } catch (err) {
            console.error(
              `Error stopping monitoring session ${sessionId}:`,
              err
            );
          }
        })
      );
    } finally {
      // After attempting to stop all sessions, clear the sessionIds array
      sessionIdsRef.current = [];
      setIsMonitoring(false);
    }
  };

  return {
    startMonitoring,
    stopMonitoring,
    stopAllMonitoring, // Expose the new method
    checkConnection,
    isMonitoring,
    error,
  };
};
