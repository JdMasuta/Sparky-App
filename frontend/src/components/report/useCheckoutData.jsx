import { useState, useEffect } from "react";

export const useCheckoutData = () => {
  const [initialData, setInitialData] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true; // Flag to prevent setState after unmount

    const fetchData = async () => {
      try {
        setIsLoading(true);
        const response = await fetch("/api/checkouts/detailed/10", {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
          throw new Error("Expected array of checkouts");
        }

        if (!isActive) return; // Don't update state if component unmounted

        // Format timestamps
        const formattedData = data.map((entry) => ({
          ...entry,
          timestamp: new Date(entry.timestamp)
            .toLocaleString("sv-SE", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            })
            .replace(" ", "T")
            .replace("T", " "),
        }));

        setInitialData(formattedData);
      } catch (error) {
        if (error.name === "AbortError") return;
        if (isActive) {
          console.error("Error fetching data:", error);
          setError(error.message);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, []);

  // We can now include isLoading in the return object
  return { initialData, error, isLoading };
};

// Keeping the createDebounce utility in case it's needed elsewhere
export const createDebounce = (func, wait) => {
  let timeout;
  let controller;

  const debounced = (...args) => {
    if (controller) {
      controller.abort();
    }

    controller = new AbortController();

    if (timeout) {
      clearTimeout(timeout);
    }

    return new Promise((resolve) => {
      timeout = setTimeout(async () => {
        try {
          const result = await func(...args, controller.signal);
          resolve(result);
        } catch (error) {
          if (error.name !== "AbortError") {
            console.error(error);
          }
        }
      }, wait);
    });
  };

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (controller) {
      controller.abort();
    }
  };

  return debounced;
};
