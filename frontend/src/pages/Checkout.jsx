import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, X } from "lucide-react";
import useAlerts from "../components/shared/Alerts/useAlerts";
import { useCheckoutForm } from "../components/entry/useCheckoutForm";
import { useCheckoutData } from "../components/entry/useCheckoutData";
import { useCheckoutSubmit } from "../components/entry/useCheckoutSubmit";
import { useRSLinxMonitor } from "../components/entry/useRSLinxMonitor";
import { usePLCTags } from "../components/entry/usePLCTags";
import { useFieldAutomation } from "../components/entry/useFieldAutomation";
import { useExtraLines } from "../components/entry/useExtraLines";
import EntryField from "../components/shared/EntryField.jsx";
import PullOptionsModal from "../components/entry/PullModal.jsx";
import SOP from "../components/entry/SOP.jsx";
import NewProjectFlow from "../components/entry/NewProjectFlow.jsx";
import {
  classifyProjectNumber,
  findProject,
} from "../components/entry/projectNumbers.js";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";

function Checkout() {
  const [showPullModal, setShowPullModal] = useState(false);
  const { addAlert } = useAlerts();
  const { options, idMappings, projectDetails, itemDetails, allProjects, reload } =
    useCheckoutData();
  const {
    formData,
    setFormData,
    shouldShowField,
    isValidSelection,
    isInvalidQuantity,
  } = useCheckoutForm(options);
  const { extraLines, addLine, updateLine, removeLine, resetLines } =
    useExtraLines();
  const { handleSubmit: submitCheckout } = useCheckoutSubmit(
    formData,
    idMappings,
    setFormData,
    extraLines,
  );
  const {
    startMonitoring,
    stopAllMonitoring,
    checkConnection,
    isMonitoring,
    mode,
  } = useRSLinxMonitor();
  const { writeToPLC, resetStepInPLC, resetPLCvalues } = usePLCTags();
  const { fieldRefs, focusNextField } = useFieldAutomation();
  const [activeField, setActiveField] = useState(null);
  const activeFieldRef = useRef(null);

  const [isFirstLoad, setIsFirstLoad] = useState(true); // Track first load

  // #18: create (or reactivate) a project from an unknown M/A-number.
  const [newProjectRequest, setNewProjectRequest] = useState(null);
  const [pendingProject, setPendingProject] = useState(null);
  const projectCandidate = String(formData.project ?? "").trim();
  const projectKind = classifyProjectNumber(projectCandidate);
  const matchedProject = projectKind
    ? findProject(allProjects, projectCandidate)
    : null;
  const canCreateProject = Boolean(projectKind) && !matchedProject;
  const isInactiveMatch =
    Boolean(matchedProject) &&
    String(matchedProject.status ?? "ACTIVE").toUpperCase() !== "ACTIVE";

  const startNewProjectFlow = () => {
    if (canCreateProject) {
      setNewProjectRequest({ kind: projectKind, value: projectCandidate, existing: null });
    } else if (isInactiveMatch) {
      setNewProjectRequest({ kind: projectKind, value: projectCandidate, existing: matchedProject });
    }
  };

  const handleProjectSaved = async (row) => {
    setNewProjectRequest(null);
    await reload();
    setPendingProject(row.project_number);
  };

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
      extraLines.length === 0 &&
      !hasHandledAutoLogic.current
    ) {
      hasHandledAutoLogic.current = true;
      handleAutoLogic();
    }
  }, [formData.item, options.items]);

  // Once the reloaded option list contains the new/reactivated project, select
  // it through the normal field-change path so it is written to the PLC.
  useEffect(() => {
    if (!pendingProject) return;
    if (options.projects.includes(pendingProject)) {
      handleFieldChange({ target: { name: "project", value: pendingProject } });
    }
    setPendingProject(null);
  }, [pendingProject, options.projects]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleAutoLogic = async () => {
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
        message: response["lineCount"]
          ? `Checkout submission successful!\n${response["lineCount"]} lines, total quantity: ${response["quantity"]}`
          : `Checkout submission successful!\nQuantity: ${response["quantity"]}`,
        severity: "success",
        timeout: 5,
      });
      resetLines();
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

  // #17: multi-line checkout. Lines after the first reuse name/project and are
  // manual-quantity only; adding the first extra line stops the PLC monitor.
  const isMultiLine = extraLines.length > 0;
  const isLineValid = (item, quantity) =>
    isValidSelection(item, options.items) && !isInvalidQuantity(quantity);
  const allLinesValid =
    isLineValid(formData.item, formData.quantity) &&
    extraLines.every((line) => isLineValid(line.item, line.quantity));
  const focusLineId = useRef(null);

  const handleAddLine = () => {
    focusLineId.current = addLine();
    if (!hasHandledManualEntry.current) {
      hasHandledManualEntry.current = true;
      stopAllMonitoring();
    }
  };

  const renderAddLine = () => (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="hidden flex-1 sm:block" />
      <div className="hidden flex-1 sm:block" />
      <div className="flex-1">
        <button
          type="button"
          onClick={handleAddLine}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-600 hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
        >
          <Plus className="h-4 w-4" /> Add line
        </button>
      </div>
      <div className="hidden flex-1 sm:block" />
    </div>
  );

  const renderReadOnly = (label, value) => (
    <div className="flex-1">
      <span className="mb-1 block text-sm font-medium text-slate-600">
        {label}
      </span>
      <input
        readOnly
        tabIndex={-1}
        value={value ?? ""}
        aria-label={label}
        className="block w-full rounded-lg border-0 bg-slate-50 px-3 py-2.5 text-slate-500 ring-1 ring-inset ring-slate-200"
      />
    </div>
  );

  const handleManualEntry = async () => {
    if (isMultiLine && !allLinesValid) return;
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
      optionDetails: projectDetails,
      labelAction: canCreateProject ? (
        <button
          type="button"
          onClick={startNewProjectFlow}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-brand-600 hover:bg-brand-50"
        >
          <Plus className="h-3.5 w-3.5" /> New project
        </button>
      ) : null,
      ref: fieldRefs.project,
    },
    {
      label: "Item",
      name: "item",
      placeholder: "Type or select item...",
      options: options.items,
      optionDetails: itemDetails,
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
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">
          Cable Checkout
        </h1>
        {mode === "sim" && <Badge tone="amber">Simulation mode</Badge>}
        {mode === "real" && <Badge tone="green">Live PLC</Badge>}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              {fields.map((field) => (
                <EntryField
                  key={field.name}
                  {...field}
                  value={formData[field.name]}
                  onChange={handleFieldChange}
                  onFocus={() => handleFieldFocus(field.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && field.name === "quantity")
                      handleManualEntry();
                    if (e.key === "Enter" && field.name === "project")
                      startNewProjectFlow();
                  }}
                  showField={shouldShowField(field.name)}
                />
              ))}
            </div>

            {!isMultiLine && shouldShowField("quantity") && renderAddLine()}

            {extraLines.map((line, index) => (
              <div key={line.id} className="space-y-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                  {renderReadOnly("Name", formData.name)}
                  {renderReadOnly("Project", formData.project)}
                  <EntryField
                    ref={(el) => {
                      if (el && focusLineId.current === line.id) {
                        focusLineId.current = null;
                        el.focus();
                      }
                    }}
                    label="Item"
                    name={`item-${line.id}`}
                    placeholder="Type or select item..."
                    value={line.item}
                    options={options.items}
                    optionDetails={itemDetails}
                    onChange={(e) => updateLine(line.id, "item", e.target.value)}
                  />
                  <div className="flex flex-1 items-end gap-1">
                    <EntryField
                      label="Quantity"
                      name={`quantity-${line.id}`}
                      placeholder="Enter quantity..."
                      pattern={"^\\d*\\.?\\d*$"}
                      type="number"
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(line.id, "quantity", e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleManualEntry();
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="rounded-md p-2.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                      aria-label="Remove line"
                      title="Remove line"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {index === extraLines.length - 1 &&
                  isValidSelection(line.item, options.items) &&
                  renderAddLine()}
              </div>
            ))}

            {shouldShowField("quantity") && (isMultiLine || formData.quantity) && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleManualEntry}
                  disabled={
                    isMultiLine
                      ? !allLinesValid
                      : isInvalidQuantity(formData.quantity)
                  }
                >
                  Manual Entry
                </Button>
              </div>
            )}
          </form>
        </div>

        <SOP
          activeField={activeField}
          isManualEntryVisible={
            shouldShowField("quantity") && formData.quantity
          }
          formData={formData}
        />
      </div>

      <NewProjectFlow
        request={newProjectRequest}
        onSaved={handleProjectSaved}
        onClose={() => setNewProjectRequest(null)}
      />

      <PullOptionsModal
        isOpen={showPullModal}
        onClose={() => {
          stopAllMonitoring();
          setShowPullModal(false);
        }}
        onManualEntry={handleManualEntry}
      />
    </div>
  );
}

export default Checkout;
