import { useState, useRef, useCallback } from "react";

// Additional checkout lines (#17). Line 1 stays in the main form state; these
// lines reuse its name/project and carry their own item + manual quantity.
export const useExtraLines = () => {
  const [extraLines, setExtraLines] = useState([]);
  const nextId = useRef(1);

  const addLine = useCallback(() => {
    const id = nextId.current++;
    setExtraLines((prev) => [...prev, { id, item: "", quantity: "" }]);
    return id;
  }, []);

  const updateLine = useCallback((id, field, value) => {
    setExtraLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, [field]: value } : line))
    );
  }, []);

  const removeLine = useCallback((id) => {
    setExtraLines((prev) => prev.filter((line) => line.id !== id));
  }, []);

  const resetLines = useCallback(() => setExtraLines([]), []);

  return { extraLines, addLine, updateLine, removeLine, resetLines };
};
