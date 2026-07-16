const VARIANTS = {
  primary: "bg-brand-500 text-white hover:bg-brand-600 focus-visible:outline-brand-600 disabled:bg-brand-300",
  secondary:
    "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-slate-400 disabled:text-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-700 disabled:bg-red-300",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:outline-slate-400",
};

const SIZES = {
  sm: "px-2.5 py-1.5 text-xs gap-1",
  md: "px-3.5 py-2 text-sm gap-1.5",
  lg: "px-4 py-2.5 text-base gap-2",
};

export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  children,
  ...props
}) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-lg font-medium shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
