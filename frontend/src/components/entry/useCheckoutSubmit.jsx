async function getQuantity(quantity) {
  if (quantity === null) {
    console.warn("Quantity is null, retrieving backup quantity...");
    try {
      const response = await fetch("/api/pull/backup-quantity", {
        method: "GET",
      });
      if (!response.ok) {
        throw new Error("Failed to retrieve backup quantity from API.");
      }
      const data = await response.json();
      return data.value ?? null;
    } catch (error) {
      console.error("Error retrieving backup quantity:", error);
      throw error;
    }
  }
  return quantity;
}

export const useCheckoutSubmit = (
  formData,
  idMappings,
  setFormData,
  extraLines = [],
) => {
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Declared outside try so the catch block can safely reference it.
    let checkoutData = { quantity: null };
    try {
      const userId = idMappings.users.get(formData.name);
      const projectId = idMappings.projects.get(formData.project);
      const itemId = idMappings.items.get(formData.item);

      checkoutData = {
        user_id: userId,
        project_id: projectId,
        item_id: itemId,
        quantity: parseFloat(formData.quantity) || null,
        // No client timestamp — the server records it authoritatively.
      };

      // Multi-line checkout (#17): manual quantities only, saved all-or-nothing.
      if (extraLines.length > 0) {
        const rows = [
          checkoutData,
          ...extraLines.map((line) => ({
            user_id: userId,
            project_id: projectId,
            item_id: idMappings.items.get(line.item),
            quantity: parseFloat(line.quantity) || null,
          })),
        ];
        console.log("Submitting checkout batch:", JSON.stringify(rows));
        const response = await fetch("/api/checkouts/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        });
        if (!response.ok) {
          throw new Error("Failed to submit checkout batch");
        }
        resetForm();
        return {
          quantity: rows.reduce((sum, row) => sum + (row.quantity || 0), 0),
          lineCount: rows.length,
          success: true,
        };
      }

      // Handle null quantity by fetching backup
      if (checkoutData.quantity === null) {
        checkoutData.quantity = await getQuantity(checkoutData.quantity);
      }

      console.log("Submitting checkout:", JSON.stringify(checkoutData));
      const response = await fetch("/api/checkouts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(checkoutData),
      });

      if (!response.ok) {
        throw new Error("Failed to submit checkout");
      }

      resetForm(); // Reset form on successful submission
      return {
        quantity: checkoutData.quantity,
        success: true,
      };
    } catch (error) {
      console.error("Error submitting checkout:", error);
      alert("Failed to submit checkout. Please try again.");
      return {
        quantity: checkoutData.quantity,
        success: false,
      };
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      project: "",
      item: "",
      quantity: "",
    });
  };

  return { handleSubmit, resetForm };
};
