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
  /** 다른 Plot에서 줌 시 X축 동기화 */
  xAxisRange?: [string, string] | null;
}

// title prop 제거됨 - 각 Plot의 제목은 MultiPlotPanel에서 헤더로 표시

/**
 * Plotly.js 기반 단일 시계열 차트.
 * - 선택된 컬럼별 trace 생성
 * - 두 번째 컬럼은 우측 Y축(y2) 사용
 * - 투명 배경으로 카드 스타일과 통합
 */
export const SinglePlot = memo(function SinglePlot({
  data,
  selectedColumns,
  onRelayout,
  xAxisRange,
}: SinglePlotProps) {
  // 날짜 배열 (X축 공통)
  const dates = useMemo(() => data.map((d) => d.date), [data]);

  // 선택된 컬럼별 Plotly trace 생성
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
          // 두 번째 이후 컬럼은 우측 Y축 (단위가 다른 변수 동시 표시)
          yaxis: idx === 0 ? "y" : "y2",
          // null 구간 선 끊김 (센서 미측정 구간 명확히 표현)
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
      // 투명 배경 (카드 배경색 그대로 표시)
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
      // X축: 날짜 타입, 범위 슬라이더 (시간축 탐색 편의)
      xaxis: {
        type: "date" as const,
        range: xAxisRange ?? undefined,
        rangeslider: { thickness: 0.04 },
        tickfont: { size: 9 },
      },
      // 왼쪽 Y축
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
      // 오른쪽 Y축 (두 번째 컬럼이 있을 때만 활성화)
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
      // 같은 날짜의 모든 값을 통합 툴팁으로 표시
      hovermode: "x unified" as const,
    }),
    [selectedColumns, xAxisRange]
  );

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        데이터 없음
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
        // 불필요한 툴바 버튼 제거 (UI 간소화)
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
