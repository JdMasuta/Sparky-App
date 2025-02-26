// ../components/entry/useCheckoutData.jsx
import { useState, useEffect } from "react";

export const useCheckoutData = () => {
  const [options, setOptions] = useState({
    users: [],
    projects: [],
    items: [],
  });

  const [idMappings, setIdMappings] = useState({
    users: new Map(),
    projects: new Map(),
    items: new Map(),
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch("/api/table_data/active", {
          method: "GET",
        });
        const data = await response.json();

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

        setOptions({
          users: data.users.map((user) => user.name),
          projects: data.projects.map((project) => project.project_number),
          items: data.items.map((item) => item.sku),
        });
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchData();
  }, []);

  return { options, idMappings };
};
