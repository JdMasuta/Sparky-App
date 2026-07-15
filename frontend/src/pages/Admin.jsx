import { useEffect, useState } from "react";
import { LayoutDashboard, Table2, Mail, Settings, LogOut } from "lucide-react";
import { api } from "../lib/api.js";
import Spinner from "../components/ui/Spinner.jsx";
import Button from "../components/ui/Button.jsx";
import { Input } from "../components/ui/Field.jsx";
import AdminOverview from "../components/admin/AdminOverview.jsx";
import AdminTables from "../components/admin/AdminTables.jsx";
import AdminReports from "../components/admin/AdminReports.jsx";
import AdminSystem from "../components/admin/AdminSystem.jsx";

const SECTIONS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, Component: AdminOverview },
  { id: "tables", label: "Tables", icon: Table2, Component: AdminTables },
  { id: "reports", label: "Reports & Email", icon: Mail, Component: AdminReports },
  { id: "system", label: "System", icon: Settings, Component: AdminSystem },
];

function LoginScreen({ onAuthed }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.post("/auth/login", { password });
      onAuthed();
    } catch (err) {
      setError(err.message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-800">Admin Dashboard</h1>
      <p className="mt-1 mb-4 text-sm text-slate-500">Sign in to manage the system.</p>
      <form onSubmit={submit} className="space-y-4">
        <Input
          id="admin-password"
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
          autoFocus
          autoComplete="current-password"
        />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}

export default function Admin() {
  const [authed, setAuthed] = useState(null); // null = checking
  const [section, setSection] = useState("overview");

  useEffect(() => {
    api
      .get("/auth/session")
      .then((d) => setAuthed(!!d.authenticated))
      .catch(() => setAuthed(false));
  }, []);

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      /* ignore */
    }
    setAuthed(false);
  };

  if (authed === null) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }
  if (!authed) return <LoginScreen onAuthed={() => setAuthed(true)} />;

  const Active = SECTIONS.find((s) => s.id === section).Component;

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Admin Dashboard</h1>
        <Button variant="secondary" size="sm" onClick={logout}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-slate-200">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              section === id
                ? "border-brand-500 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <Active />
    </div>
  );
}
