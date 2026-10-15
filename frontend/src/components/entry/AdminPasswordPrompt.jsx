import { useState } from "react";
import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";
import { Input } from "../ui/Field.jsx";
import { api } from "../../lib/api.js";

// Asks for the admin password before an operator may create/reactivate a
// project from Checkout. Signs in through the normal admin login endpoint
// (rate-limited server-side) and reports success to the caller.
export default function AdminPasswordPrompt({ isOpen, message, onAuthorized, onCancel }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    if (!password) {
      setError("Password is required");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await api.post("/auth/login", { password });
      setPassword("");
      onAuthorized();
    } catch (err) {
      setError(
        err.status === 429
          ? "Too many attempts. Wait a few minutes and try again."
          : err.status === 401
            ? "Invalid password"
            : err.message || "Sign-in failed"
      );
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setPassword("");
    setError("");
    onCancel();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={cancel}
      title="Admin authorization"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Checking…" : "Authorize"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        {message && <p className="text-sm text-slate-600">{message}</p>}
        <Input
          id="checkout-admin-password"
          label="Admin password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
          autoComplete="current-password"
        />
      </form>
    </Modal>
  );
}
