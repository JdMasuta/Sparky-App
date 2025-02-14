import React, { useEffect, useRef } from "react";
import { debounce as createDebounce } from "lodash";

const FetchPullsData = ({ setTodaysPulls, setWeeksPulls }) => {
  const fetchDataRef = useRef();

  useEffect(() => {
    const fetchData = createDebounce(async (signal) => {
      const result = await Promise.all([
        fetch("/api/checkouts/stats", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          signal,
        }).then((res) => res.json()),
      ]);
      console.log(result);

      setTodaysPulls(result[0].today_count);
      setWeeksPulls(result[0].week_count);
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
