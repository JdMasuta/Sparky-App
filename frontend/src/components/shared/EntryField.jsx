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
      optionDetails = {},
      pattern,
      showField = true,
      hidden = false,
      type = "text",
    },
    ref
  ) => {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const containerRef = useRef(null);

    useEffect(() => {
      const handleClickOutside = (event) => {
        // Notifications live outside the container; interacting with one must not close the dropdown.
        if (event.target.closest?.("[data-alerts-overlay]")) return;
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
    const query = String(fieldValue).toLowerCase();
    // optionDetails maps an option to extra lines shown (and searched) under it.
    const filteredOptions = options.filter((option) =>
      [option, ...(optionDetails[option] || [])].some((text) =>
        String(text).toLowerCase().includes(query)
      )
    );

    const selectOption = (option) => {
      onChange({ target: { name, value: option } });
      setIsDropdownOpen(false);
      setHighlightedIndex(-1);
    };

    const handleChange = (e) => {
      setHighlightedIndex(-1);
      onChange(e);
    };

    const handleKeyDown = (e) => {
      const isOpen = isDropdown && isDropdownOpen && filteredOptions.length > 0;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (isDropdown && filteredOptions.length > 0) {
          e.preventDefault();
          if (!isOpen) {
            setIsDropdownOpen(true);
            return;
          }
          const step = e.key === "ArrowDown" ? 1 : -1;
          setHighlightedIndex(
            (i) => (i + step + filteredOptions.length) % filteredOptions.length
          );
          return;
        }
      } else if (e.key === "Enter" && isOpen && filteredOptions[highlightedIndex]) {
        e.preventDefault();
        selectOption(filteredOptions[highlightedIndex]);
        return;
      } else if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        setIsDropdownOpen(false);
        setHighlightedIndex(-1);
        return;
      }
      onKeyDown?.(e);
    };

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
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => isDropdown && setIsDropdownOpen(true)}
          onInput={handleChange}
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
                ref={(el) => {
                  if (index === highlightedIndex) el?.scrollIntoView?.({ block: "nearest" });
                }}
                className={`cursor-pointer px-3 py-2 text-sm hover:bg-brand-50 hover:text-brand-700 ${
                  index === highlightedIndex ? "bg-brand-50 text-brand-700" : "text-slate-700"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectOption(option);
                }}
              >
                {option}
                {(optionDetails[option] || []).map((line, i) => (
                  <div key={i} className="text-xs text-slate-400">
                    {line}
                  </div>
                ))}
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
