import React, { useMemo } from "react";
import { Info } from "lucide-react";

// Standard-operating-procedure panel: shows the instruction for the active step.
const SOP = ({ activeField, isManualEntryVisible }) => {
  const instructions = useMemo(() => {
    if (!activeField) {
      return "Welcome to Cable Checkout. Please start by selecting or typing your name.";
    }
    if (isManualEntryVisible) {
      return "Review your entries and click 'Manual Entry' to complete the checkout.";
    }
    switch (activeField) {
      case "name":
        return "Step 1: Enter your full name or select from the dropdown list.";
      case "project":
        return "Step 2: Select the project this cable is associated with.";
      case "item":
        return "Step 3: Select the item you want to check out.";
      case "quantity":
        return "Step 4: For automatic cable pulls, proceed to the HMI to start the motor. For manual pulls, enter the quantity you pulled and press Enter (or click 'Manual Entry') to complete the checkout.";
      default:
        return "Please complete all required fields.";
    }
  }, [activeField, isManualEntryVisible]);

  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50 p-5">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
        <div>
          <h2 className="text-sm font-semibold text-brand-800">Instructions</h2>
          <p className="mt-1 text-sm text-slate-600">{instructions}</p>
        </div>
      </div>
    </div>
  );
};

export default React.memo(SOP);
