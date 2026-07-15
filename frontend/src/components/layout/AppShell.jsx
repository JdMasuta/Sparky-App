/* global __APP_VERSION__ */
import { NavLink } from "react-router-dom";
import { Home, BarChart3, ClipboardCheck, Shield } from "lucide-react";
import logo from "../../assets/images/BW.png";

const NAV = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/report", label: "Report", icon: BarChart3 },
  { to: "/checkout", label: "Checkout", icon: ClipboardCheck },
  { to: "/admin", label: "Admin", icon: Shield },
];

const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

export default function AppShell({ children }) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 bg-brand-500 px-4 py-2.5 shadow-md">
        <img
          src={logo}
          alt="BW Integrated Systems"
          className="h-11 w-auto rounded bg-white/95 p-1"
        />
        <div className="leading-tight">
          <h1 className="text-xl font-semibold text-white">Sparky Cart</h1>
          <p className="text-xs text-brand-100">Cable Control System</p>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="hidden w-52 shrink-0 border-r border-slate-200 bg-white sm:block">
          <nav className="flex flex-col gap-1 p-3">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-slate-600 hover:bg-slate-100"
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Mobile top nav */}
        <div className="sm:hidden" />

        {/* Main content */}
        <main className="min-w-0 flex-1 bg-slate-100">
          {/* Mobile nav bar */}
          <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white p-2 sm:hidden">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                    isActive ? "bg-brand-50 text-brand-700" : "text-slate-600"
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="mx-auto max-w-6xl p-4 sm:p-6">{children}</div>
        </main>
      </div>

      {/* Footer */}
      <footer className="flex flex-col items-center gap-0.5 border-t border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-400">
        <div>Sparky Cart · Cable Control System</div>
        <div>Contributors: Josh Meesey, Jeremiah Holabird, Richard Smith</div>
        <div>Version {version}</div>
      </footer>
    </div>
  );
}
