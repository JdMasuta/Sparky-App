import React, { useState, useEffect, useRef, useCallback } from "react";
import useAlerts from "../components/shared/Alerts/useAlerts";
import { useCheckoutForm } from "../components/entry/useCheckoutForm";
import { useCheckoutData } from "../components/entry/useCheckoutData";
import { useCheckoutSubmit } from "../components/entry/useCheckoutSubmit";
import { useRSLinxMonitor } from "../components/entry/useRSLinxMonitor";
import { usePLCTags } from "../components/entry/usePLCTags";
import { useFieldAutomation } from "../components/entry/useFieldAutomation";
import EntryField from "../components/shared/EntryField.jsx";
import PullOptionsModal from "../components/entry/PullModal.jsx";
import SOP from "../components/entry/SOP.jsx";

function Checkout() {
  const [showPullModal, setShowPullModal] = useState(false);
  const { addAlert } = useAlerts();
  const { options, idMappings } = useCheckoutData();
  const {
    formData,
    setFormData,
    shouldShowField,
    handleInputChange,
    isValidSelection,
    isInvalidQuantity,
  } = useCheckoutForm(options);
  const { handleSubmit: submitCheckout, resetForm } = useCheckoutSubmit(
    formData,
    idMappings,
    setFormData
  );
  const {
    startMonitoring,
    stopMonitoring,
    stopAllMonitoring,
    checkConnection,
    isMonitoring,
  } = useRSLinxMonitor();
  const { writeToPLC, resetStepInPLC, resetPLCvalues } = usePLCTags();
  const { fieldRefs, focusNextField } = useFieldAutomation();
  const [activeField, setActiveField] = useState(null);
  const activeFieldRef = useRef(null);

  const [isFirstLoad, setIsFirstLoad] = useState(true); // Track first load

  const optionKeyMap = {
    name: "users",
    project: "projects",
    item: "items",
    quantity: null, // No options for quantity
  };

  // Focus the first field only on initial page load
  useEffect(() => {
    const controller = new AbortController();

    const ensureDDEConnection = async () => {
      try {
        const data = await checkConnection(); // If checkConnection uses fetch, you could pass controller.signal
        console.log("Connection status:", {
          available: data.available,
          message: data.message,
        });
        return data.available;
      } catch (error) {
        // Only log errors that aren't caused by an abort
        if (error.name !== "AbortError") {
          console.error("Error ensuring DDE connection:", error);
        }
      }
    };

    const initializePage = async () => {
      if (isFirstLoad && fieldRefs.name) {
        try {
          setIsFirstLoad(false); // Prevent further re-initialization

          const connection = await ensureDDEConnection(); // Make sure connection is established
          stopAllMonitoring();

          setActiveField("name");

          fieldRefs.name.current.focus(); // Focus the name field
          resetStepInPLC(); // Reset the step in the PLC
          resetPLCvalues(); // Reset the values for name, project, item

          const connectionStatus = [
            connection === true ? "connected" : "not connected...",
            connection === true ? "success" : "error",
          ];
          addAlert({
            message: `RSLinx is ${connectionStatus[0]}`,
            severity: connectionStatus[1],
            timeout: 5,
          });
        } catch (error) {
          // Again, only log errors that aren't due to an abort
          if (error.name !== "AbortError") {
            console.error("Error initializing page:", error);
          }
        }
      }
    };

    initializePage();

    // Cleanup: abort any ongoing fetch requests
    return () => {
      controller.abort();
    };
  }, [isFirstLoad, fieldRefs]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isMonitoring) {
        stopAllMonitoring();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isMonitoring, stopAllMonitoring]);

  useEffect(() => {
    // Called when the item field is populated - Starts monitoring, and ensures fieldData[item] is set
    if (
      formData.item &&
      isValidSelection(formData.item, options.items) &&
      !hasHandledAutoLogic.current
    ) {
      hasHandledAutoLogic.current = true;
      handleAutoLogic();
    }
  }, [formData.item, options.items]);

  const hasHandledAutoLogic = useRef(false);
  const hasHandledManualEntry = useRef(false);

  const handleFieldChange = async (e) => {
    const { name, value } = e.target;

    // 1. Update the form data
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    // 1.1 Save the current field as active for the SOP

    if (activeFieldRef.current !== name) {
      setActiveField(name);
    }

    // 2. Perform any immediate PLC logic or validation checks as needed
    const optionsKey = optionKeyMap[name];
    const fieldHasOptions = Boolean(optionsKey && options[optionsKey]);
    if (
      name !== "quantity" &&
      (!fieldHasOptions ||
        (fieldHasOptions && isValidSelection(value, options[optionsKey])))
    ) {
      e.target.disabled = true;
      const success = await writeToPLC(name, value);
      e.target.disabled = false;

      const getNextField = (currentField) => {
        const fieldOrder = ["name", "project", "item", "quantity"];
        const currentIndex = fieldOrder.indexOf(currentField);
        if (currentIndex >= 0 && currentIndex < fieldOrder.length - 1) {
          return fieldOrder[currentIndex + 1];
        }
        return null;
      };

      // Update the active field before focusing the next field
      const nextField = getNextField(name);
      if (nextField) {
        setActiveField(nextField);
      }

      focusNextField(name);

      // If PLC write was successful, do something (update UI, etc.)
      if (success) {
        console.log(`Wrote ${value} to PLC:`, name);
      }
    }
  };

  const handleFieldFocus = useCallback((fieldName) => {
    setActiveField(fieldName);
  }, []);

  useEffect(() => {
    activeFieldRef.current = activeField;
  }, [activeField]);

  const handleAutoLogic = async (e) => {
    if (!isMonitoring) {
      await startMonitoring(async (quantity) => {
        // If manual entry is triggered, skip or early return
        if (hasHandledManualEntry.current) {
          console.log("Manual entry triggered; skipping auto logic");
          return;
        }
        if (!isNaN(formData.quantity)) {
          setFormData((prev) => ({
            ...prev,
            quantity: quantity.toString(),
          }));
          if (isMonitoring) {
            stopAllMonitoring();
          }
          // Once formData is set, you then call your handleSubmit
          handleSubmit(new Event("submit"));
        }
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log(formData);
    const response = await submitCheckout(e);
    if (response["success"]) {
      addAlert({
        message: `Checkout submission successful!\nQuantity: ${response["quantity"]}`,
        severity: "success",
        timeout: 5,
      });
      await resetStepInPLC();
      fieldRefs.name.current.focus(); // Focus the first field (name)
      setActiveField(fieldRefs.name.current.name);
    } else {
      addAlert({
        message: "Checkout submission failed!",
        severity: "error",
        timeout: 5,
      });
    }
    hasHandledAutoLogic.current = false;
    hasHandledManualEntry.current = false;
  };

  const handleManualEntry = async () => {
    hasHandledManualEntry.current = true;
    try {
      await stopAllMonitoring(); // Stop the monitoring process
      console.log("Manual entry initiated.");
    } catch (err) {
      console.error("Error while stopping monitoring:", err);
    }

    // setShowPullModal(false);
    await handleSubmit(new Event("submit"));
  };

  const fields = [
    {
      label: "Name",
      name: "name",
      placeholder: "Type or select name...",
      options: options.users,
      ref: fieldRefs.name,
    },
    {
      label: "Project",
      name: "project",
      placeholder: "Type or select project...",
      options: options.projects,
      ref: fieldRefs.project,
    },
    {
      label: "Item",
      name: "item",
      placeholder: "Type or select item...",
      options: options.items,
      ref: fieldRefs.item,
    },
    {
      label: "Quantity",
      name: "quantity",
      placeholder: "Enter quantity...",
      pattern: "^\\d*\\.?\\d*$",
      type: "number",
      ref: fieldRefs.quantity,
      //hidden: true,
    },
  ];

  return (
    <div>
      <div className="container">
        <div className="checkout-form-container">
          <h1 className="checkout-title">Cable Checkout</h1>

          <form className="checkout-form">
            <div className="checkout-fields-horizontal">
              {fields.map((field) => (
                <EntryField
                  key={field.name}
                  {...field}
                  value={formData[field.name]}
                  onChange={handleFieldChange}
                  onFocus={() => handleFieldFocus(field.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && field.name == "quantity")
                      handleManualEntry();
                  }}
                  showField={shouldShowField(field.name)}
                />
              ))}
            </div>

            <div className="checkout-submit">
              {shouldShowField("quantity") && formData.quantity && (
                <button
                  type="button"
                  className="checkout-button"
                  onClick={handleManualEntry}
                  disabled={isInvalidQuantity(formData.quantity)}
                >
                  Manual Entry
                </button>
              )}
            </div>
          </form>
        </div>
        <div className="sop-container-wrapper">
          <SOP
            activeField={activeField}
            isManualEntryVisible={
              shouldShowField("quantity") && formData.quantity
            }
            formData={formData}
          />
        </div>
      </div>
      <div>
        <PullOptionsModal
          isOpen={showPullModal}
          onClose={() => {
            stopAllMonitoring();
            setShowPullModal(false);
          }}
          onManualEntry={handleManualEntry}
        />
      </div>
    </div>
  );
}

export default Checkout;
