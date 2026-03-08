"use client";

/**
 * SCR-003: Well Raw Data Visualisation Page
 *
 * Displays ESP sensor data for a well across 4 Plotly charts (2x2 grid).
 * The common header/tabs are handled in layout.tsx, so this page
 * is only responsible for DateRangePicker + MultiPlotPanel.
 */

import { use, useState } from "react";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiPlotPanel } from "@/components/charts/MultiPlotPanel";
import { useWellData } from "@/hooks/useWellData";
import { useChartStore } from "@/lib/store";

interface WellDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Date range input component.
 * Uses the browser's native date input (simple implementation without external libraries).
 */
function DateRangePicker({
  startDate,
  endDate,
  onChange,
}: {
  startDate: string | null;
  endDate: string | null;
  onChange: (start: string | null, end: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
      <input
        type="date"
        value={startDate ?? ""}
        onChange={(e) => onChange(e.target.value || null, endDate)}
        className="border rounded px-2 py-1 text-xs bg-background"
      />
      <span className="text-muted-foreground">~</span>
      <input
        type="date"
        value={endDate ?? ""}
        onChange={(e) => onChange(startDate, e.target.value || null)}
        className="border rounded px-2 py-1 text-xs bg-background"
      />
      {(startDate || endDate) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => onChange(null, null)}
        >
          Reset
        </Button>
      )}
    </div>
  );
}

export default function WellDetailPage({ params }: WellDetailPageProps) {
  // Next.js 16: params is a Promise – unwrap with use()
  const { id } = use(params);

  const { setDateRange } = useChartStore();
  const [localStart, setLocalStart] = useState<string | null>(null);
  const [localEnd, setLocalEnd] = useState<string | null>(null);

  const { data: espData, isLoading: dataLoading } = useWellData({
    wellId: id,
    startDate: localStart,
    endDate: localEnd,
  });

  const handleDateChange = (start: string | null, end: string | null) => {
    setLocalStart(start);
    setLocalEnd(end);
    // Bidirectional sync between the Plotly X-axis and DateRangePicker
    setDateRange(start, end);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar: date range + data summary */}
      <div className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0">
        <DateRangePicker
          startDate={localStart}
          endDate={localEnd}
          onChange={handleDateChange}
        />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {espData?.total !== undefined && (
            <span>{espData.total.toLocaleString()} rows</span>
          )}
          {espData?.date_range && (
            <span>
              {espData.date_range.start} ~ {espData.date_range.end}
            </span>
          )}
          {dataLoading && <span className="text-primary">Loading...</span>}
        </div>
      </div>

      {/* 4-plot visualisation area */}
      <div className="flex-1 p-4 min-h-0">
        <MultiPlotPanel
          data={espData?.data ?? []}
          isLoading={dataLoading && !espData}
        />
      </div>
    </div>
  );
}
