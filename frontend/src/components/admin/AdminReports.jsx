import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Send } from "lucide-react";
import Card from "../ui/Card.jsx";
import Button from "../ui/Button.jsx";
import Badge from "../ui/Badge.jsx";
import DataTable from "../ui/DataTable.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import { Input } from "../ui/Field.jsx";
import useAlerts from "../shared/Alerts/useAlerts.jsx";
import { api } from "../../lib/api.js";
import { formatDateTime } from "../../lib/tableSchemas.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const daysAgoISO = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

export default function AdminReports() {
  const { addAlert } = useAlerts();
  const [recipients, setRecipients] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [toRemove, setToRemove] = useState(null);
  const [since, setSince] = useState(daysAgoISO(7));
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, h] = await Promise.all([
        api.get("/report_recipients"),
        api.get("/weekly_report_status"),
      ]);
      setRecipients(r);
      setHistory([...h].reverse());
    } catch (err) {
      addAlert({ message: `Failed to load: ${err.message}`, severity: "error", timeout: 6 });
    } finally {
      setLoading(false);
    }
  }, [addAlert]);

  useEffect(() => {
    load();
  }, [load]);

  const addRecipient = async () => {
    const email = newEmail.trim();
    if (!EMAIL_RE.test(email)) {
      setEmailError("Enter a valid email address");
      return;
    }
    setEmailError("");
    try {
      await api.post("/report_recipients", { email });
      setNewEmail("");
      addAlert({ message: "Recipient added.", severity: "success", timeout: 3 });
      await load();
    } catch (err) {
      setEmailError(err.message || "Could not add recipient");
    }
  };

  const removeRecipient = async () => {
    try {
      await api.del(`/report_recipients/${toRemove.id}`);
      setToRemove(null);
      await load();
    } catch (err) {
      addAlert({ message: err.message, severity: "error", timeout: 6 });
    }
  };

  const sendNow = async () => {
    if (recipients.length === 0) {
      addAlert({ message: "No recipients to send to.", severity: "warning", timeout: 4 });
      return;
    }
    setSending(true);
    const timestamp = `${since} 00:00:00`;
    let ok = 0;
    let failed = 0;
    for (const r of recipients) {
      try {
        await api.post("/email/email-report", { timestamp, email: r.email });
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setSending(false);
    addAlert({
      message: `Report sent to ${ok} recipient(s)${failed ? `, ${failed} failed` : ""}.`,
      severity: failed ? "warning" : "success",
      timeout: 5,
    });
    await load();
  };

  return (
    <div className="space-y-5">
      <Card
        title="Send report now"
        actions={
          <Button onClick={sendNow} disabled={sending} size="sm">
            <Send className="h-4 w-4" /> {sending ? "Sending…" : "Send to all"}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Input
            id="since"
            label="Include checkouts since"
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="w-auto"
          />
          <p className="pb-2 text-xs text-slate-400">
            Sends the checkout report to every recipient below.
          </p>
        </div>
      </Card>

      <Card title={`Recipients (${recipients.length})`}>
        <DataTable
          loading={loading}
          rows={recipients}
          rowKey={(r) => r.id}
          empty="No recipients configured."
          columns={[
            { key: "email", header: "Email" },
            {
              key: "_actions",
              header: "",
              className: "text-right",
              render: (r) => (
                <button
                  onClick={() => setToRemove(r)}
                  className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                  aria-label="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ),
            },
          ]}
        />
        <div className="mt-4 flex items-start gap-2 border-t border-slate-100 pt-4">
          <div className="flex-1">
            <Input
              id="new-email"
              placeholder="email@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRecipient()}
              error={emailError}
            />
          </div>
          <Button onClick={addRecipient} className="mt-0">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </Card>

      <Card title="Weekly report history">
        <DataTable
          loading={loading}
          rows={history.slice(0, 20)}
          rowKey={(h) => h.id}
          empty="No weekly reports have run yet."
          columns={[
            { key: "ran_at", header: "Ran at", render: (h) => formatDateTime(h.ran_at) },
            {
              key: "success",
              header: "Result",
              render: (h) => (
                <Badge tone={h.success ? "green" : "red"}>{h.success ? "Success" : "Failed"}</Badge>
              ),
            },
            { key: "error_message", header: "Detail", render: (h) => h.error_message || "—" },
          ]}
        />
      </Card>

      <ConfirmDialog
        isOpen={!!toRemove}
        onClose={() => setToRemove(null)}
        onConfirm={removeRecipient}
        title="Remove recipient?"
        confirmLabel="Remove"
        message={`Stop sending the weekly report to ${toRemove?.email}?`}
      />
    </div>
  );
}
