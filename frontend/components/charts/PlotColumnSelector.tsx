"use client";

import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { COLUMN_CONFIG, COLUMN_GROUPS } from "./columnConfig";
import { useChartStore, type ColumnKey } from "@/lib/store";

interface PlotColumnSelectorProps {
  plotIndex: 0 | 1 | 2 | 3;
}

/**
 * Column selection dropdown for an individual plot.
 * Lists columns grouped by category and shows a color indicator
 * to preview the chart line color.
 * Enforces a minimum of 1 selected column (cannot deselect the last one).
 */
export function PlotColumnSelector({ plotIndex }: PlotColumnSelectorProps) {
  const { plots, togglePlotColumn } = useChartStore();
  const selectedColumns = plots[plotIndex].selectedColumns;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Settings icon button – positioned on the right side of the plot header */}
        <Button variant="ghost" size="icon" className="h-6 w-6" title="Select Variables">
          <Settings2 className="h-3 w-3" />
        </Button>
      </PopoverTrigger>

      {/* Column selection dropdown panel */}
      <PopoverContent className="w-72 p-2" align="end">
        <p className="text-xs font-semibold text-muted-foreground mb-2 px-1">
          Select variables to display (max 2 recommended)
        </p>

        <div className="space-y-3 max-h-80 overflow-y-auto">
          {Object.entries(COLUMN_GROUPS).map(([group, columns]) => (
            <div key={group}>
              {/* Group header */}
              <div className="text-xs font-medium text-muted-foreground border-b pb-1 mb-1 px-1">
                {group}
              </div>

              {/* Column list within the group */}
              <div className="space-y-1">
                {columns.map((colKey: ColumnKey) => {
                  const meta = COLUMN_CONFIG[colKey];
                  const isChecked = selectedColumns.includes(colKey);
                  // The last selected item cannot be deselected
                  const isDisabled = isChecked && selectedColumns.length === 1;

                  return (
                    <label
                      key={colKey}
                      className={`flex items-center gap-2 px-1 py-0.5 rounded text-xs cursor-pointer hover:bg-muted transition-colors ${
                        isDisabled ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                    >
                      {/* Chart line color indicator */}
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: meta.color }}
                      />
                      <Checkbox
                        checked={isChecked}
                        disabled={isDisabled}
                        onCheckedChange={() => togglePlotColumn(plotIndex, colKey)}
                        className="h-3 w-3"
                      />
                      <span>
                        {meta.label}
                        {meta.unit && (
                          <span className="text-muted-foreground ml-1">({meta.unit})</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
