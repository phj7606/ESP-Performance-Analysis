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
 * 개별 Plot의 컬럼 선택 드롭다운.
 * 그룹별로 컬럼을 나열하고, 색상 인디케이터로 차트 선 색상을 미리 표시.
 * 최소 1개 선택 강제 (마지막 체크 해제 불가).
 */
export function PlotColumnSelector({ plotIndex }: PlotColumnSelectorProps) {
  const { plots, togglePlotColumn } = useChartStore();
  const selectedColumns = plots[plotIndex].selectedColumns;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* ⚙ 아이콘 버튼 - Plot 헤더 우측 */}
        <Button variant="ghost" size="icon" className="h-6 w-6" title="변수 선택">
          <Settings2 className="h-3 w-3" />
        </Button>
      </PopoverTrigger>

      {/* 컬럼 선택 드롭다운 패널 */}
      <PopoverContent className="w-72 p-2" align="end">
        <p className="text-xs font-semibold text-muted-foreground mb-2 px-1">
          표시할 변수 선택 (최대 2개 권장)
        </p>

        <div className="space-y-3 max-h-80 overflow-y-auto">
          {Object.entries(COLUMN_GROUPS).map(([group, columns]) => (
            <div key={group}>
              {/* 그룹 헤더 */}
              <div className="text-xs font-medium text-muted-foreground border-b pb-1 mb-1 px-1">
                {group}
              </div>

              {/* 그룹 내 컬럼 목록 */}
              <div className="space-y-1">
                {columns.map((colKey: ColumnKey) => {
                  const meta = COLUMN_CONFIG[colKey];
                  const isChecked = selectedColumns.includes(colKey);
                  // 마지막 선택된 항목은 체크 해제 불가
                  const isDisabled = isChecked && selectedColumns.length === 1;

                  return (
                    <label
                      key={colKey}
                      className={`flex items-center gap-2 px-1 py-0.5 rounded text-xs cursor-pointer hover:bg-muted transition-colors ${
                        isDisabled ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                    >
                      {/* 차트 선 색상 인디케이터 */}
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
