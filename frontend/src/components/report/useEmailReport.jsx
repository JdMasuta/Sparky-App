import { useState } from "react";

export const useEmailReport = ({ timestamp }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const sendEmailReport = async (email, timestamp) => {
    const formatTimestamp = (date) => {
      const pad = (n) => (n < 10 ? "0" + n : n);
      const year = date.getFullYear();
      const month = pad(date.getMonth() + 1);
      const day = pad(date.getDate());

      // Set the time to 15:30:00
      const hours = "15";
      const minutes = "30";
      const seconds = "0";

      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    timestamp = formatTimestamp;
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
