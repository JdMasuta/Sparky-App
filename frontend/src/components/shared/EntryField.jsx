// ../components/shared/CheckoutField.jsx
import React, { forwardRef, useState, useEffect, useRef } from "react";

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
    if (!showField) return null;

    const isDropdown = options.length > 0;
    const fieldClassName = `checkout-field fade-in${hidden ? " hidden" : ""}`;
    const fieldValue = hidden ? "0" : value;

    // Add filtering logic for the dropdown options
    const filteredOptions = options.filter((option) =>
      option.toLowerCase().includes(fieldValue.toLowerCase())
    );

    // State to track whether the custom dropdown is open.
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    // A ref to the wrapper element, used for click-outside detection.
    const containerRef = useRef(null);

    // Close the dropdown if a click is detected outside the component.
    useEffect(() => {
      const handleClickOutside = (event) => {
        if (
          containerRef.current &&
          !containerRef.current.contains(event.target)
        ) {
          setIsDropdownOpen(false);
        }
      };

      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }, []);

    return (
      <div ref={containerRef} className={fieldClassName}>
        <label htmlFor={name} className="checkout-label">
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
          // When the input is focused and options exist, open the custom dropdown.
          onFocus={() => {
            if (isDropdown) {
              setIsDropdownOpen(true);
            }
          }}
          // Optionally, you can manage onBlur here.
          // We rely on the click-outside logic to close the dropdown.
          onInput={(e) => {
            onChange(e);
            // Optionally, if the typed value exactly matches an option,
            // you can treat it as a selection.
            if (options.includes(e.target.value)) {
              console.log(`Selection detected for ${name}: ${e.target.value}`);
              onChange(e);
            }
          }}
          className="checkout-input"
          placeholder={placeholder}
          pattern={pattern}
          autoComplete="off"
        />
        {isDropdown && isDropdownOpen && (
          <ul className="custom-dropdown">
            {filteredOptions.map((option, index) => (
              <li
                key={index}
                className="custom-dropdown-item"
                onMouseDown={(e) => {
                  // Prevent the input from blurring before the click is registered.
                  e.preventDefault();
                  // Create a synthetic event to pass to onChange.
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

// Add display name for debugging purposes.
EntryField.displayName = "CheckoutField";

export default EntryField;
