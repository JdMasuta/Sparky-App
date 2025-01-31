import React, { useEffect, useRef } from "react";
import { debounce as createDebounce } from "lodash";

const FetchPullsData = ({ setTodaysPulls, setWeeksPulls }) => {
  const fetchDataRef = useRef();

  useEffect(() => {
    const fetchData = createDebounce(async (signal) => {
      const today = new Date();
      const midnightToday = new Date(today.setHours(0, 0, 0, 0))
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      const midnightWeekAgo = new Date(today.setDate(today.getDate() - 7))
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");

      const [todaysData, weeksData] = await Promise.all([
        fetch("/api/checkouts/detailed/after", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ timestamp: midnightToday }),
          signal,
        }).then((res) => res.json()),
        fetch("/api/checkouts/detailed/after", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ timestamp: midnightWeekAgo }),
          signal,
        }).then((res) => res.json()),
      ]);

      setTodaysPulls(todaysData.length);
      setWeeksPulls(weeksData.length);
    }, 1000);

    // Store the debounced function in a ref so we can clean it up
    fetchDataRef.current = fetchData;
    fetchData();

    return () => {
      if (fetchDataRef.current) {
        fetchDataRef.current.cancel();
      }
    };
  }, [setTodaysPulls, setWeeksPulls]);

  return null;
};

export default FetchPullsData;
