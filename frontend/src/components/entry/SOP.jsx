import React, { useMemo } from "react";

// SOP component that displays instructions based on the current step
const SOP = ({ activeField, isManualEntryVisible, formData }) => {
  // Memoize the instructions based on the current state
  const instructions = useMemo(() => {
    // If no field is active yet
    if (!activeField) {
      return "Welcome to Cable Checkout. Please start by selecting or typing your name.";
    }

    // If manual entry button is visible
    if (isManualEntryVisible) {
      return "Review your entries and click 'Manual Entry' to complete the checkout.";
    }

    // Instructions based on active field
    switch (activeField) {
      case "name":
        return "Step 1: Enter your full name or select from the dropdown list.";
      case "project":
        return "Step 2: Select the project this cable is associated with.";
      case "item":
        return "Step 3: Select the item you want to check out.";
      case "quantity":
        return "Step 4: For Automatic cable pulls, proceed to the HMI to continue. For Manual pulls, enter the quantity you pulled and press Enter or click 'Manual Entry' button to complete the checkout.";
      default:
        return "Please complete all required fields.";
    }
  }, [activeField, isManualEntryVisible]);

  return (
    <div className="sop-container">
      <div className="sop-content">
        <h2>Instructions</h2>
        <p>{instructions}</p>
      </div>
    </div>
  );
};

export default React.memo(SOP);
