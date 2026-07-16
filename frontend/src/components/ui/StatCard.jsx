export default function StatCard({ title, value, subtitle, icon: Icon, tone = "brand" }) {
  const tones = {
    brand: "bg-brand-50 text-brand-600",
    slate: "bg-slate-100 text-slate-600",
    green: "bg-green-50 text-green-600",
    amber: "bg-amber-50 text-amber-600",
  };
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {Icon && (
        <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
        <p className="text-2xl font-semibold text-slate-800">{value}</p>
        {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
      </div>
    </div>
  );
}
