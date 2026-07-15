import { useEffect } from "react";
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from "lucide-react";

const STYLES = {
  info: { icon: Info, ring: "ring-brand-200", bar: "bg-brand-500", text: "text-brand-800" },
  success: { icon: CheckCircle2, ring: "ring-green-200", bar: "bg-green-500", text: "text-green-800" },
  warning: { icon: AlertTriangle, ring: "ring-amber-200", bar: "bg-amber-500", text: "text-amber-800" },
  error: { icon: XCircle, ring: "ring-red-200", bar: "bg-red-500", text: "text-red-800" },
};

const Alert = ({ message = "", severity = "info", timeout = 0, handleDismiss = null }) => {
  useEffect(() => {
    if (timeout > 0 && handleDismiss) {
      const timer = setTimeout(handleDismiss, timeout * 1000);
      return () => clearTimeout(timer);
    }
  }, [timeout, handleDismiss]);

  if (!message) return null;
  const style = STYLES[severity] || STYLES.info;
  const Icon = style.icon;

  return (
    <div
      role="alert"
      className={`animate-fade-in flex w-80 items-start gap-3 overflow-hidden rounded-lg bg-white p-3.5 shadow-lg ring-1 ${style.ring}`}
    >
      <span className={`mt-0.5 shrink-0 ${style.text}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold capitalize ${style.text}`}>{severity}</p>
        <p className="whitespace-pre-line break-words text-sm text-slate-600">{message}</p>
      </div>
      {handleDismiss && (
        <button
          onClick={handleDismiss}
          className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};

export default Alert;
