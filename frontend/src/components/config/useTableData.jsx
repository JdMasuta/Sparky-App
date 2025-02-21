import { useState, useCallback } from "react";

const TABLE_NAMES = ["users", "projects", "items", "checkouts"];

function useTableData() {
  const [tablesData, setTablesData] = useState({
    users: [],
    projects: [],
    items: [],
    checkouts: [],
  });

  /**
   * Helper function to fetch data from a specific table
   */
  const fetchTableData = useCallback(async (table) => {
    try {
      const response = await fetch(`/api/${table}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${table}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(error);
      return []; // Return empty array or handle error as needed
    }
  }, []);

  /**
   * Preload all defined tables in TABLE_NAMES
   * Uses Promise.all for parallel fetching
   */
  const preloadTables = useCallback(async () => {
    try {
      const results = await Promise.all(TABLE_NAMES.map(fetchTableData));

      // Build an object mapping table name -> fetched data
      const dataMap = TABLE_NAMES.reduce((acc, tableName, index) => {
        acc[tableName] = results[index];
        return acc;
      }, {});

      setTablesData(dataMap);
    } catch (error) {
      console.error("Failed to preload tables:", error);
    }
  }, [fetchTableData]);

  /**
   * Helper to determine the correct HTTP method given an operation
   */
  const getMethodFromOperation = (operation) => {
    const methods = {
      create: "POST",
      edit: "PUT",
      delete: "DELETE",
    };
    return methods[operation] || "GET";
  };

  /**
   * Update a specific table with the given operation
   */
  const updateTable = useCallback(
    async (table, operation, entry, id = null) => {
      const method = getMethodFromOperation(operation);
      const url = id ? `/api/${table}/${id}` : `/api/${table}`;

      try {
        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          // Only include a body for non-DELETE requests, converting to JSON.
          body: operation !== "delete" ? JSON.stringify(entry) : undefined,
        });

        if (!response.ok) {
          throw new Error(
            `Failed to ${operation} to ${table} table: ${response.statusText}`
          );
        }

        // Refetch the updated data for this table
        const updatedData = await fetchTableData(table);
        setTablesData((prev) => ({ ...prev, [table]: updatedData }));

        // !! Add real logging !!
        console.log(
          `Table "${table}" updated successfully!: ${operation} on ${id}`
        );
      } catch (error) {
        console.error(error);
      }
    },
    [fetchTableData]
  );

  return {
    tablesData,
    preloadTables,
    updateTable,
    fetchTableData, // Exposed if needed externally
    setTablesData, // Exposed if you need to manually set data
  };
}

export default useTableData;
