import { forwardRef, useState, useEffect, useRef } from "react";

// Checkout field: a text input with an optional type-ahead dropdown. Hooks are
// declared unconditionally (before any early return) to satisfy the Rules of
// Hooks — the previous version returned null before calling hooks, which threw
// "rendered fewer hooks than expected" when a field toggled visibility.
const EntryField = forwardRef(
  (
    {
      label,
      name,
      value,
      onChange,
      onKeyDown,
      placeholder,
      options = [],
      pattern,
      showField = true,
      hidden = false,
      type = "text",
    },
    ref
  ) => {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
      const handleClickOutside = (event) => {
        if (containerRef.current && !containerRef.current.contains(event.target)) {
          setIsDropdownOpen(false);
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    if (!showField) return null;

    const isDropdown = options.length > 0;
    const fieldValue = hidden ? "0" : value ?? "";
    const filteredOptions = options.filter((option) =>
      option.toLowerCase().includes(String(fieldValue).toLowerCase())
    );

    return (
      <div ref={containerRef} className={`animate-fade-in relative flex-1 ${hidden ? "hidden" : ""}`}>
        <label htmlFor={name} className="mb-1 block text-sm font-medium text-slate-600">
          {label}
        </label>
        <input
          ref={ref}
          type={type}
          id={name}
          name={name}
          value={fieldValue}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => isDropdown && setIsDropdownOpen(true)}
          onInput={(e) => onChange(e)}
          className="block w-full rounded-lg border-0 px-3 py-2.5 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500"
          placeholder={placeholder}
          pattern={pattern}
          autoComplete="off"
        />
        {isDropdown && isDropdownOpen && filteredOptions.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {filteredOptions.map((option, index) => (
              <li
                key={index}
                className="cursor-pointer px-3 py-2 text-sm text-slate-700 hover:bg-brand-50 hover:text-brand-700"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange({ target: { name, value: option } });
                  setIsDropdownOpen(false);
                }}
              >
                {option}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
);

EntryField.displayName = "CheckoutField";

export default EntryField;
