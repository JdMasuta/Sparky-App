async function getQuantity(quantity) {
  if (quantity === null) {
    console.warn("Quantity is null, retrieving backup quantity...");
    try {
      const response = await fetch("/api/RSLinx/tags/Reel.RealData[10]", {
        method: "GET",
      });
      if (!response.ok) {
        throw new Error("Failed to retrieve backup quantity from API.");
      }
      const data = await response.json(); // Adjust this based on API response
      return data.value || null; // Assuming API returns an object with `quantity`
    } catch (error) {
      console.error("Error retrieving backup quantity:", error);
      throw error;
    }
  }
  return quantity;
}

export const useCheckoutSubmit = (formData, idMappings, setFormData) => {
  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const userId = idMappings.users.get(formData.name);
      const projectId = idMappings.projects.get(formData.project);
      const itemId = idMappings.items.get(formData.item);

      const now = new Date();
      const options = {
        timeZone: "America/Denver",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      };
      const timestamp = now
        .toLocaleString("sv-SE", options)
        .replace(" ", "T")
        .replace(/-/g, "-")
        .replace(/:/g, ":");

      let checkoutData = {
        user_id: userId,
        project_id: projectId,
        item_id: itemId,
        quantity: parseFloat(formData.quantity) || null,
        timestamp: timestamp,
      };

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

      // alert("Checkout submitted successfully!");
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
