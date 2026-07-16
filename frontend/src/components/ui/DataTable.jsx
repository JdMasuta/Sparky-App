import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import Spinner from "./Spinner.jsx";

// Lightweight data table. `columns` is
//   [{ key, header, render?, filterValue?, filterable?, className? }].
// When `filterable` is set on the table, a filter row appears under the headers;
// each column is matched (case-insensitive substring) against its DISPLAYED
// value — `filterValue(row)` if given, else the raw `row[key]`.
export default function DataTable({
  columns,
  rows,
  rowKey,
  loading,
  empty = "No records.",
  filterable = false,
}) {
  const [filters, setFilters] = useState({});

  const displayValue = (col, row) => {
    if (col.filterValue) return String(col.filterValue(row) ?? "");
    const raw = row[col.key];
    return raw === null || raw === undefined ? "" : String(raw);
  };

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v.trim() !== "");
    if (active.length === 0) return rows || [];
    return (rows || []).filter((row) =>
      active.every(([key, v]) => {
        const col = columns.find((c) => c.key === key);
        return (
          col && displayValue(col, row).toLowerCase().includes(v.toLowerCase())
        );
      }),
    );
  }, [rows, filters, columns]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">{empty}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                {col.header}
              </th>
            ))}
          </tr>
          {filterable && (
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="px-2 pb-2">
                  {col.filterable === false ? null : (
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-300" />
                      <input
                        value={filters[col.key] || ""}
                        onChange={(e) =>
                          setFilters((f) => ({
                            ...f,
                            [col.key]: e.target.value,
                          }))
                        }
                        placeholder="Filter…"
                        className="w-full rounded-md border-0 py-1 pl-7 pr-2 text-xs font-normal normal-case text-slate-700 ring-1 ring-inset ring-slate-200 focus:ring-brand-400"
                      />
                    </div>
                  )}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="py-6 text-center text-sm text-slate-400"
              >
                No rows match the current filters.
              </td>
            </tr>
          ) : (
            filtered.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-slate-50">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`whitespace-nowrap px-3 py-2.5 text-slate-700 ${col.className || ""}`}
                  >
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
