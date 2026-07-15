import { useState } from "react";
import { api } from "../../lib/api.js";

export const useEmailReport = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Note: /api/email/* is admin-only, so this succeeds only for a signed-in
  // admin (the api wrapper sends the session cookie + CSRF header).
  const sendEmailReport = async (email, timestamp) => {
    setIsLoading(true);
    setError(null);
    setSuccess(false);
    try {
      await api.post("/email/email-report", { timestamp, email });
      setSuccess(true);
    } catch (err) {
      setError(err.message);
      console.error("Error sending email report:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return { sendEmailReport, isLoading, error, success };
};
