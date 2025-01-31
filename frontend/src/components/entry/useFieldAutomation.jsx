// ../components/entry/useFieldAutomation.jsx
import { useRef } from "react";

export const useFieldAutomation = () => {
  const fieldRefs = {
    name: useRef(null),
    project: useRef(null),
    item: useRef(null),
    quantity: useRef(null),
  };

  const getNextField = (currentField) => {
    const fieldOrder = ["name", "project", "item", "quantity"];
    const currentIndex = fieldOrder.indexOf(currentField);
    return currentIndex < fieldOrder.length - 1
      ? fieldOrder[currentIndex + 1]
      : null;
  };

  const focusNextField = (currentField) => {
    const nextField = getNextField(currentField);
    if (nextField && fieldRefs[nextField]?.current) {
      fieldRefs[nextField].current.focus();
    }
  };

  return {
    fieldRefs,
    focusNextField,
  };
};
