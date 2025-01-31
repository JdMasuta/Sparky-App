// ../components/shared/CheckoutField.jsx
import React, { forwardRef } from "react";

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

    return (
      <div className={fieldClassName}>
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
          onInput={(e) => {
            onChange(e);
            // If the value matches an option exactly, treat it as a selection
            if (options.includes(e.target.value)) {
              console.log(`Selection detected for ${name}: ${e.target.value}`);
              onChange(e);
            }
          }}
          className="checkout-input"
          placeholder={placeholder}
          pattern={pattern}
          list={isDropdown ? `${name}-list` : undefined}
          autoComplete="off"
        />
        {isDropdown && (
          <datalist id={`${name}-list`}>
            {options.map((option, index) => (
              <option key={index} value={option} />
            ))}
          </datalist>
        )}
      </div>
    );
  }
);

// Add display name for debugging purposes
EntryField.displayName = "CheckoutField";

export default EntryField;
