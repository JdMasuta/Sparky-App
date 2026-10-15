// ../components/entry/useCheckoutData.jsx
import { useState, useEffect, useCallback } from "react";

export const useCheckoutData = () => {
  const [options, setOptions] = useState({
    users: [],
    projects: [],
    items: [],
  });

  // Secondary lines (A-number, project name) shown under each project option.
  const [projectDetails, setProjectDetails] = useState({});
  // Item name shown under each SKU option.
  const [itemDetails, setItemDetails] = useState({});

  // Every project regardless of status, used to tell "unknown" M/A-numbers
  // (offer to create) from inactive ones (offer to reactivate).
  const [allProjects, setAllProjects] = useState([]);

  const [idMappings, setIdMappings] = useState({
    users: new Map(),
    projects: new Map(),
    items: new Map(),
  });

  const reload = useCallback(async () => {
    try {
      const [response, allResponse] = await Promise.all([
        fetch("/api/table_data/active", { method: "GET" }),
        fetch("/api/projects", { method: "GET" }),
      ]);
      const data = await response.json();
      if (allResponse.ok) setAllProjects(await allResponse.json());

      const userMap = new Map(
        data.users.map((user) => [user.name, user.user_id])
      );
      const projectMap = new Map(
        data.projects.map((project) => [
          project.project_number,
          project.project_id,
        ])
      );
      const itemMap = new Map(
        data.items.map((item) => [item.sku, item.item_id])
      );

      setIdMappings({
        users: userMap,
        projects: projectMap,
        items: itemMap,
      });

      setProjectDetails(
        Object.fromEntries(
          data.projects.map((project) => [
            project.project_number,
            [project.a_number, project.name].filter(Boolean),
          ])
        )
      );

      setItemDetails(
        Object.fromEntries(
          data.items.map((item) => [item.sku, [item.name].filter(Boolean)])
        )
      );

      setOptions({
        users: data.users.map((user) => user.name),
        projects: data.projects.map((project) => project.project_number),
        items: data.items.map((item) => item.sku),
      });
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { options, idMappings, projectDetails, itemDetails, allProjects, reload };
};
