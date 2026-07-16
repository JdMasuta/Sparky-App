// Labeled form controls with inline validation errors. One component per control
// type keeps call sites readable in the schema-driven Add/Edit forms.

const baseInput =
  "block w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500";

function Wrapper({ label, htmlFor, error, required, children, hint }) {
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-slate-400">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function Input({ label, error, required, hint, id, className = "", ...props }) {
  const ringColor = error ? "ring-red-400" : "ring-slate-300";
  return (
    <Wrapper label={label} htmlFor={id} error={error} required={required} hint={hint}>
      <input id={id} className={`${baseInput} ${ringColor} ${className}`} {...props} />
    </Wrapper>
  );
}

export function TextArea({ label, error, required, hint, id, className = "", ...props }) {
  const ringColor = error ? "ring-red-400" : "ring-slate-300";
  return (
    <Wrapper label={label} htmlFor={id} error={error} required={required} hint={hint}>
      <textarea id={id} rows={3} className={`${baseInput} ${ringColor} ${className}`} {...props} />
    </Wrapper>
  );
}

export function Select({ label, error, required, hint, id, options = [], placeholder, className = "", ...props }) {
  const ringColor = error ? "ring-red-400" : "ring-slate-300";
  return (
    <Wrapper label={label} htmlFor={id} error={error} required={required} hint={hint}>
      <select id={id} className={`${baseInput} ${ringColor} bg-white ${className}`} {...props}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => {
          const value = typeof opt === "object" ? opt.value : opt;
          const text = typeof opt === "object" ? opt.label : opt;
          return (
            <option key={value} value={value}>
              {text}
            </option>
          );
        })}
      </select>
    </Wrapper>
  );
}
