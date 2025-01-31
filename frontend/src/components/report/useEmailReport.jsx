import { useState } from "react";

export const useEmailReport = ({ timestamp }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const sendEmailReport = async (email) => {
    const controller = new AbortController();
    let isActive = true;

    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch("/api/email/email-report", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({ timestamp, email }), // Use the dynamic email
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (!isActive) return;
      setSuccess(true);
    } catch (err) {
      if (err.name === "AbortError") return;
      if (isActive) {
        setError(err.message);
        console.error("Error sending email report:", err);
      }
    } finally {
      if (isActive) {
        setIsLoading(false);
      }
    }

    return () => {
      isActive = false;
      controller.abort();
    };
  };

  return {
    sendEmailReport,
    isLoading,
    error,
    success,
  };
};
