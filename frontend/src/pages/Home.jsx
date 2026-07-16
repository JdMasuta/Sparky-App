import { Link } from "react-router-dom";
import { BarChart3, ClipboardCheck, Shield, ArrowRight, Cpu, Database, Mail } from "lucide-react";
import Card from "../components/ui/Card.jsx";

const QUICK_LINKS = [
  { to: "/checkout", icon: ClipboardCheck, title: "Checkout", desc: "Log a cable pull from the floor." },
  { to: "/report", icon: BarChart3, title: "Reports", desc: "Recent pulls and weekly totals." },
  { to: "/admin", icon: Shield, title: "Admin Dashboard", desc: "Manage tables, recipients, and the system." },
];

const FEATURES = [
  { icon: Cpu, title: "Hardware control", desc: "Talks to the ControlLogix PLC over EtherNet/IP and tracks encoder feedback in real time." },
  { icon: Database, title: "Data management", desc: "Projects, cable inventory, and a full log of pulling operations in SQLite." },
  { icon: Mail, title: "Automated reporting", desc: "Weekly checkout reports generated and emailed to the recipient list." },
];

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-8 text-white shadow-sm">
        <h1 className="text-3xl font-bold">Sparky Control System</h1>
        <p className="mt-2 max-w-2xl text-brand-50">
          A modern web application for controlling and monitoring the Sparky cable-pulling
          machine, running on the edge device wired to the plant PLC.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {QUICK_LINKS.map(({ to, icon: Icon, title, desc }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Icon className="h-5 w-5" />
            </div>
            <h2 className="mt-3 flex items-center gap-1 text-base font-semibold text-slate-800">
              {title}
              <ArrowRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500" />
            </h2>
            <p className="mt-1 text-sm text-slate-500">{desc}</p>
          </Link>
        ))}
      </section>

      <Card title="What it does">
        <div className="grid gap-6 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title}>
              <Icon className="h-5 w-5 text-brand-500" />
              <h3 className="mt-2 text-sm font-semibold text-slate-700">{title}</h3>
              <p className="mt-1 text-sm text-slate-500">{desc}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
