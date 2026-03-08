"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { PlotRelayoutEvent } from "plotly.js";
import { Skeleton } from "@/components/ui/skeleton";
import { PlotColumnSelector } from "./PlotColumnSelector";
import { PLOT_DEFAULTS } from "./plotDefaults";
import { useChartStore } from "@/lib/store";
import type { EspDataPoint } from "@/lib/api";

// SSR must be disabled for Plotly.js:
// it directly references window/document objects and will error on the server side
const SinglePlot = dynamic(
  () => import("./SinglePlot").then((m) => m.SinglePlot),
  {
    ssr: false,
    loading: () => (
      <Skeleton className="w-full h-full rounded-md" />
    ),
  }
);

interface MultiPlotPanelProps {
  data: EspDataPoint[];
  isLoading: boolean;
}

/**
 * Container that arranges 4 Plotly charts in a 2x2 grid.
 * - X-axis sync: zooming in one plot synchronises the other three
 * - Variable selection: each plot is independent (PlotColumnSelector)
 */
export function MultiPlotPanel({ data, isLoading }: MultiPlotPanelProps) {
  const { plots, setDateRange } = useChartStore();
  // Synced X-axis range: null means full range; a value synchronises all 4 plots
  const [syncedXRange, setSyncedXRange] = useState<[string, string] | null>(null);

  /**
   * Plotly relayout event handler.
   * Saves the X-axis range to shared state on zoom/pan to synchronise all 4 plots.
   * Restores the full range on double-click (autorange).
   */
  const handleRelayout = useCallback(
    (event: PlotRelayoutEvent) => {
      const e = event as Record<string, unknown>;
      if (e["xaxis.range[0]"] !== undefined && e["xaxis.range[1]"] !== undefined) {
        const range: [string, string] = [
          String(e["xaxis.range[0]"]),
          String(e["xaxis.range[1]"]),
        ];
        setSyncedXRange(range);
        setDateRange(range[0], range[1]);
      } else if (e["xaxis.autorange"]) {
        // Double-click: restore full range
        setSyncedXRange(null);
        setDateRange(null, null);
      }
    },
    [setDateRange]
  );

  return (
    // 2x2 grid layout
    // minHeight is explicit: Plotly autosize requires the parent to have a defined height
    <div
      className="grid grid-cols-2 grid-rows-2 gap-3 h-full"
      style={{ minHeight: "680px" }}
    >
      {PLOT_DEFAULTS.map((config, idx) => (
        <div
          key={idx}
          className="relative bg-card border rounded-lg flex flex-col overflow-hidden"
        >
          {/* Plot header: title + variable selector button */}
          <div className="flex items-center justify-between px-3 pt-2 pb-1 flex-shrink-0">
            <div>
              <span className="text-xs font-medium">Plot {idx + 1}</span>
              <span className="text-xs text-muted-foreground ml-2">{config.title}</span>
            </div>
            {/* Independent variable selector per plot */}
            <PlotColumnSelector plotIndex={idx as 0 | 1 | 2 | 3} />
          </div>

          {/* Chart area: flex-1 consumes all remaining space */}
          <div className="flex-1 min-h-0 px-1 pb-1">
            {isLoading ? (
              <Skeleton className="w-full h-full rounded-md" />
            ) : (
              <SinglePlot
                data={data}
                selectedColumns={plots[idx].selectedColumns}
                onRelayout={handleRelayout}
                xAxisRange={syncedXRange}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
