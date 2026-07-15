// Checkout PLC interaction, expressed as INTENTS against the backend gateway.
// The browser no longer writes raw PLC tags; it tells the backend which field
// the operator set, and the backend validates it against the DB and performs
// the whitelisted tag write via the loopback bridge.
import { useState } from "react";

// Checkout form field -> intent field understood by POST /api/pull/field.
const FIELD_INTENT = { name: "user", project: "project", item: "item" };

export const usePLCTags = () => {
  const [error, setError] = useState(null);

  const postField = async (field, value) => {
    const res = await fetch("/api/pull/field", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  };

  const writeToPLC = async (fieldName, value) => {
    const intent = FIELD_INTENT[fieldName];
    if (!intent) return true; // e.g. quantity — nothing to hand off to the PLC
    try {
      await postField(intent, value);
      setError(null);
      return true;
    } catch (err) {
      console.error("Error writing field to PLC:", err);
      setError(err.message);
      return false;
    }
  };

  const resetPull = async () => {
    try {
      const res = await fetch("/api/pull/reset", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setError(null);
      return true;
    } catch (err) {
      console.error("Error resetting pull:", err);
      setError(err.message);
      return false;
    }
  };

  // Both reset entry points now clear the handshake (step 1), which the PLC/sim
  // treats as a full cycle reset (clears the operator/project/item strings).
  return {
    writeToPLC,
    resetStepInPLC: resetPull,
    resetPLCvalues: resetPull,
    error,
  };
};
