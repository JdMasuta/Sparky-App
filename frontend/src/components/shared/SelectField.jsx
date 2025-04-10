import React from "react";

/**
 * A reusable select dropdown component
 * @param {string} name - The name of the select field
 * @param {string} value - The current value
 * @param {function} onChange - Function to handle value changes
 * @param {Array} options - Array of options for the dropdown
 * @param {string} placeholder - Placeholder text (optional)
 */
function SelectField({ name, value, onChange, options, placeholder }) {
  return (
    <select
      name={name}
      value={value || ""}
      onChange={onChange}
      className="entry-field"
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

export default SelectField;
