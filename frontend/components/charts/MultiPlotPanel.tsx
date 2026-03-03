"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { PlotRelayoutEvent } from "plotly.js";
import { Skeleton } from "@/components/ui/skeleton";
import { PlotColumnSelector } from "./PlotColumnSelector";
import { PLOT_DEFAULTS } from "./plotDefaults";
import { useChartStore } from "@/lib/store";
import type { EspDataPoint } from "@/lib/api";

// ⚠️ SSR 비활성화 필수
// Plotly.js는 window/document 객체를 직접 참조하므로 서버사이드에서 실행하면 에러 발생
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
 * 4개 Plotly 차트를 2x2 그리드로 배치하는 컨테이너.
 * - X축 동기화: 한 Plot에서 줌 → 나머지 3개 동기화
 * - 변수 선택: 각 Plot 독립적 (PlotColumnSelector)
 */
export function MultiPlotPanel({ data, isLoading }: MultiPlotPanelProps) {
  const { plots, setDateRange } = useChartStore();
  // X축 동기화 상태: null이면 전체 범위, 값이 있으면 해당 구간으로 4개 Plot 동기화
  const [syncedXRange, setSyncedXRange] = useState<[string, string] | null>(null);

  /**
   * Plotly relayout 이벤트 핸들러.
   * 줌/팬 시 X축 범위를 공유 상태로 저장하여 4개 Plot 동기화.
   * 더블클릭(autorange) 시 전체 범위로 복원.
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
        // 더블클릭 → 전체 범위 복원
        setSyncedXRange(null);
        setDateRange(null, null);
      }
    },
    [setDateRange]
  );

  return (
    // 2x2 그리드 레이아웃
    // minHeight 명시: Plotly autosize가 올바르게 동작하려면 부모에 명시적 높이 필요
    <div
      className="grid grid-cols-2 grid-rows-2 gap-3 h-full"
      style={{ minHeight: "680px" }}
    >
      {PLOT_DEFAULTS.map((config, idx) => (
        <div
          key={idx}
          className="relative bg-card border rounded-lg flex flex-col overflow-hidden"
        >
          {/* Plot 헤더: 제목 + 변수 선택 버튼 */}
          <div className="flex items-center justify-between px-3 pt-2 pb-1 flex-shrink-0">
            <div>
              <span className="text-xs font-medium">Plot {idx + 1}</span>
              <span className="text-xs text-muted-foreground ml-2">{config.title}</span>
            </div>
            {/* 각 Plot 독립적 변수 선택 */}
            <PlotColumnSelector plotIndex={idx as 0 | 1 | 2 | 3} />
          </div>

          {/* 차트 영역: flex-1로 남은 공간 전부 사용 */}
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
