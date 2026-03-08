"use client";

import { memo, useMemo } from "react";
import Plot from "react-plotly.js";
import type { PlotRelayoutEvent } from "plotly.js";
import type { EspDataPoint } from "@/lib/api";
import type { ColumnKey } from "@/lib/store";
import { COLUMN_CONFIG } from "./columnConfig";

interface SinglePlotProps {
  data: EspDataPoint[];
  selectedColumns: ColumnKey[];
  onRelayout?: (event: PlotRelayoutEvent) => void;
  /** Synchronise X-axis range when another plot is zoomed */
  xAxisRange?: [string, string] | null;
}

// title prop removed – each plot's title is rendered as a header in MultiPlotPanel

/**
 * Single time-series chart powered by Plotly.js.
 * - Creates one trace per selected column
 * - The second column uses the right Y-axis (y2)
 * - Transparent background blends with the card style
 */
export const SinglePlot = memo(function SinglePlot({
  data,
  selectedColumns,
  onRelayout,
  xAxisRange,
}: SinglePlotProps) {
  // Date array shared across all traces (X-axis)
  const dates = useMemo(() => data.map((d) => d.date), [data]);

  // Build a Plotly trace for each selected column
  const traces = useMemo(
    () =>
      selectedColumns.map((colKey, idx) => {
        const meta = COLUMN_CONFIG[colKey];
        const values = data.map((d) => d[colKey as keyof EspDataPoint] as number | null);

        return {
          type: "scatter" as const,
          mode: "lines" as const,
          name: `${meta.label} (${meta.unit})`,
          x: dates,
          y: values,
          // Columns beyond the first use the right Y-axis (dual-unit display)
          yaxis: idx === 0 ? "y" : "y2",
          // Break the line at null segments (clearly shows unrecorded sensor periods)
          connectgaps: false,
          line: {
            color: meta.color,
            width: 1.5,
          },
          hovertemplate: `%{x}<br>${meta.label}: %{y:.2f} ${meta.unit}<extra></extra>`,
        };
      }),
    [data, dates, selectedColumns]
  );

  const layout = useMemo(
    () => ({
      // Transparent background to show the card background colour
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      margin: { t: 8, b: 40, l: 55, r: 55 },
      showlegend: true,
      legend: {
        orientation: "h" as const,
        y: -0.18,
        x: 0,
        font: { size: 9 },
      },
      // X-axis: date type with a range slider for time-axis exploration
      xaxis: {
        type: "date" as const,
        range: xAxisRange ?? undefined,
        rangeslider: { thickness: 0.04 },
        tickfont: { size: 9 },
      },
      // Left Y-axis
      yaxis: {
        title: selectedColumns[0]
          ? {
              text: `${COLUMN_CONFIG[selectedColumns[0]].label} (${COLUMN_CONFIG[selectedColumns[0]].unit})`,
              font: { size: 9 },
            }
          : undefined,
        tickfont: { size: 9 },
        gridcolor: "rgba(128,128,128,0.15)",
      },
      // Right Y-axis (active only when a second column is selected)
      yaxis2:
        selectedColumns.length > 1
          ? {
              overlaying: "y" as const,
              side: "right" as const,
              title: {
                text: `${COLUMN_CONFIG[selectedColumns[1]].label} (${COLUMN_CONFIG[selectedColumns[1]].unit})`,
                font: { size: 9 },
              },
              tickfont: { size: 9 },
              showgrid: false,
            }
          : undefined,
      // Unified tooltip showing all values for the same date
      hovermode: "x unified" as const,
    }),
    [selectedColumns, xAxisRange]
  );

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No data
      </div>
    );
  }

  return (
    <Plot
      data={traces}
      layout={layout}
      config={{
        scrollZoom: true,
        responsive: true,
        displaylogo: false,
        // Remove unnecessary toolbar buttons to keep the UI minimal
        modeBarButtonsToRemove: [
          "select2d",
          "lasso2d",
          "autoScale2d",
        ],
      }}
      onRelayout={onRelayout}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
});
