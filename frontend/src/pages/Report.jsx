import { useState } from "react";
import { CalendarDays, CalendarRange } from "lucide-react";
import ReportsNavBar from "../components/report/ReportsNavBar.jsx";
import StatCard from "../components/ui/StatCard.jsx";
import CablePullsTable from "../components/report/CablePullsTable.jsx";
import { useCheckoutData } from "../components/report/useCheckoutData.jsx";
import FetchPullsData from "../components/report/useFetchPullsData.jsx";

export default function Report() {
  const { initialData, error, isLoading } = useCheckoutData();
  const [todaysPulls, setTodaysPulls] = useState(0);
  const [weeksPulls, setWeeksPulls] = useState(0);

  return (
    <div className="space-y-6">
      <FetchPullsData setTodaysPulls={setTodaysPulls} setWeeksPulls={setWeeksPulls} />

      <ReportsNavBar />

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Error loading data: {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard title="Today's Pulls" value={todaysPulls} subtitle="Checkouts today" icon={CalendarDays} />
        <StatCard
          title="This Week's Pulls"
          value={weeksPulls}
          subtitle="Last 7 days"
          icon={CalendarRange}
          tone="green"
        />
      </div>

      <CablePullsTable initialData={initialData} loading={isLoading} />
    </div>
  );
}
