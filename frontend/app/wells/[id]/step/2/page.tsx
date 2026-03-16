"use client";

/**
 * SCR-005: Step 2 — Health Score (Trend-Residual) Page
 *
 * Algorithm:
 * 1. Step 1 residuals (eta_proxy, v_std, t_eff) → EWMA(span=7) smoothing
 * 2. MA30 baseline + residual σ deviation penalty (P_res ≤ 40pt) + slope penalty (P_slope ≤ 60pt)
 * 3. Weighted combination (eta:0.5, v_std:0.3, t_eff:0.2) + min-floor correction
 * 4. Score range: 10–100 (SCORE_FLOOR=10 prevents Prophet extrapolation drift)
 *
 * Visualization:
 * - Dual-panel chart: top (per-feature scores), bottom (composite health score + 70/40 thresholds)
 * - Radar chart: score_eta / score_v_std / score_t_eff (depressed direction = failure cause)
 *
 * UX flow:
 * 1. Click "Run Step 2 Analysis" → Celery async task → task_id polling
 * 2. On completion: dual-panel trend chart + radar chart rendered
 */

import { use, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { WorkflowGuard } from "@/components/analysis/WorkflowGuard";
import { AnalysisRunButton } from "@/components/analysis/AnalysisRunButton";
import { useWell } from "@/hooks/useWell";
import { useStep2Result } from "@/hooks/useAnalysis";
import { isStepComplete } from "@/lib/workflow";
import type { Step2bResponse, Step2bScorePoint } from "@/lib/api";
// 챗봇 컴포넌트 및 프롬프트 빌더
import { ChatbotTrigger } from "@/components/chatbot/ChatbotTrigger";
import { ChatbotPanel } from "@/components/chatbot/ChatbotPanel";
import { buildStep2SystemPrompt } from "@/lib/chatbot-prompts";

// Disable Plotly SSR (prevents window object access errors in Next.js Turbopack)
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface Step2PageProps {
  params: Promise<{ id: string }>;
}

// ============================================================
// Dual-panel trend chart: top (per-feature scores), bottom (composite score)
// ============================================================

/**
 * Dual-panel Trend chart (Plotly subplot).
 *
 * Top panel: Per-feature health score trajectories (score_eta, score_v_std, score_t_eff)
 *   - Lower score on a feature → that feature is degrading
 * Bottom panel: Composite health score + 70/40 threshold lines
 *   - Green = Stable, Yellow = Elevated, Red = Anomalous
 */
function TrendHealthChart({
  result,
  onDateSelect,
}: {
  result: Step2bResponse;
  onDateSelect: (date: string) => void;
}) {
  const scores = result.scores;
  const dates  = scores.map((s) => s.date);

  // Per-feature deviation trajectories (Z-score, 부호 포함)
  const devEtaVals  = scores.map((s) => s.deviation_eta);
  const devVstdVals = scores.map((s) => s.deviation_v_std);
  const devTeffVals = scores.map((s) => s.deviation_t_eff);

  // Bottom 패널: Composite |Z| = |η|×0.5 + |v_std|×0.3 + |t_eff|×0.2
  // 가중 합산으로 단일 이상 크기 지표 생성 — 방향 정보 없이 심각도만 반영
  const compositeZVals = scores.map((s) =>
    Math.abs(s.deviation_eta ?? 0) * 0.5 +
    Math.abs(s.deviation_v_std ?? 0) * 0.3 +
    Math.abs(s.deviation_t_eff ?? 0) * 0.2
  );

  return (
    <Plot
      data={[
        // ── Top subplot: per-feature deviation Z-score trajectories ──
        {
          x: dates, y: devEtaVals,
          type: "scatter", mode: "lines",
          name: "Efficiency (η_proxy)",
          line: { color: "rgba(99, 102, 241, 0.7)", width: 1.5 },
          hovertemplate: "η_proxy deviation: %{y:.2f}σ<extra></extra>",
          xaxis: "x", yaxis: "y",
        },
        {
          x: dates, y: devVstdVals,
          type: "scatter", mode: "lines",
          name: "Vibration (v_std)",
          line: { color: "rgba(249, 115, 22, 0.7)", width: 1.5 },
          hovertemplate: "v_std deviation: %{y:.2f}σ<extra></extra>",
          xaxis: "x", yaxis: "y",
        },
        {
          x: dates, y: devTeffVals,
          type: "scatter", mode: "lines",
          name: "Cooling (t_eff)",
          line: { color: "rgba(20, 184, 166, 0.7)", width: 1.5 },
          hovertemplate: "t_eff deviation: %{y:.2f}σ<extra></extra>",
          xaxis: "x", yaxis: "y",
        },
        // ── Bottom subplot: Composite |Z| (weighted anomaly magnitude) ──
        // fill: tozeroy로 면적 강조 → 이상 심각도를 직관적으로 시각화
        {
          x: dates, y: compositeZVals,
          type: "scatter", mode: "lines",
          name: "Composite |Z|",
          line: { color: "rgba(99, 102, 241, 0.85)", width: 1.5 },
          fill: "tozeroy",
          fillcolor: "rgba(99, 102, 241, 0.08)",
          hovertemplate: "Composite |Z|: %{y:.3f}<extra></extra>",
          xaxis: "x2", yaxis: "y2",
        },
      ]}
      layout={{
        grid: {
          rows: 2,
          columns: 1,
          pattern: "independent" as const,
          roworder: "top to bottom" as const,
        },
        shapes: [
          // Top panel: y=0 기준선 (방향 편차의 중립 기준)
          {
            type: "line" as const, xref: "paper" as const, yref: "y" as const,
            x0: 0, x1: 1, y0: 0, y1: 0,
            line: { color: "rgba(100, 116, 139, 0.5)", dash: "solid" as const, width: 1 },
          },
          // Bottom panel: Elevated 1.0 기준선 (yellow dashed)
          {
            type: "line" as const, xref: "paper" as const, yref: "y2" as const,
            x0: 0, x1: 1, y0: 1.0, y1: 1.0,
            line: { color: "rgba(234, 179, 8, 0.6)", dash: "dot" as const, width: 1.5 },
          },
          // Bottom panel: Anomalous 2.0 기준선 (red dashed)
          {
            type: "line" as const, xref: "paper" as const, yref: "y2" as const,
            x0: 0, x1: 1, y0: 2.0, y1: 2.0,
            line: { color: "rgba(239, 68, 68, 0.7)", dash: "dot" as const, width: 2 },
          },
        ],
        annotations: [
          {
            x: 0.01, y: 1.02, xref: "paper" as const, yref: "y2" as const,
            text: "Elevated (|Z|≥1.0)", showarrow: false,
            font: { size: 9, color: "rgba(234, 179, 8, 0.8)" },
            xanchor: "left" as const, yanchor: "bottom" as const,
          },
          {
            x: 0.01, y: 2.02, xref: "paper" as const, yref: "y2" as const,
            text: "Anomalous (|Z|≥2.0)", showarrow: false,
            font: { size: 9, color: "rgba(239, 68, 68, 0.8)" },
            xanchor: "left" as const, yanchor: "bottom" as const,
          },
        ],
        // Top subplot: 방향성 Z-score (-3.5 ~ +3.5 범위)
        xaxis:  { type: "date", showticklabels: false },
        yaxis:  { title: { text: "Deviation (Z-score)" }, range: [-3.5, 3.5] },
        // Bottom subplot: Composite |Z| (0 ~ 4 범위 — 항상 양수)
        xaxis2: { title: { text: "Date" }, type: "date", matches: "x" },
        yaxis2: { title: { text: "Composite |Z|" }, range: [0, 4] },
        margin: { t: 10, r: 20, b: 50, l: 70 },
        autosize: true,
        paper_bgcolor: "transparent",
        plot_bgcolor:  "transparent",
        font:    { size: 10 },
        legend:  { orientation: "h" as const, y: -0.15, x: 0 },
        hovermode: "x unified",
      }}
      config={{ responsive: true, displayModeBar: false }}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      // Hover: pointIndex로 scores 배열 직접 인덱싱 → 날짜 문자열 포맷 불일치 문제 해결
      // unified hover 모드에서 여러 trace가 같은 x를 공유하므로 첫 번째 point의 index 사용
      onHover={(event: { points: Array<{ pointIndex: number }> }) => {
        const point = event.points[0];
        if (!point) return;
        // pointIndex = Plotly 데이터 배열상의 인덱스 → scores 배열과 1:1 대응
        const matched = result.scores[point.pointIndex];
        if (matched) onDateSelect(matched.date);
      }}
    />
  );
}


// ============================================================
// Feature score Radar Chart
// ============================================================

/**
 * Per-feature health score Radar Chart.
 *
 * 3 axes: Efficiency (η_proxy), Vibration (v_std), Cooling (t_eff)
 * Values: individual feature scores (10–100)
 * Depressed direction = root cause of degradation
 */
function FeatureScoreRadar({ point }: { point: Step2bScorePoint | null }) {
  // Show placeholder if no data point selected
  if (!point || point.deviation_eta == null) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Hover over the chart to select a date
      </div>
    );
  }

  // 레이더 차트: deviation 절대값으로 "어느 방향이 이상한지" 시각화
  const eta   = Math.abs(point.deviation_eta   ?? 0);
  const vstd  = Math.abs(point.deviation_v_std ?? 0);
  const teff  = Math.abs(point.deviation_t_eff ?? 0);
  const compositeZ = eta * 0.5 + vstd * 0.3 + teff * 0.2;
  const lowScore = compositeZ >= 1.0;

  return (
    <Plot
      data={[{
        type: "scatterpolar",
        // Closed polygon: repeat first point at end
        r: [eta, vstd, teff, eta],
        theta: ["Efficiency (η)", "Vibration (v_std)", "Cooling (t_eff)", "Efficiency (η)"],
        fill: "toself",
        fillcolor: lowScore
          ? "rgba(239, 68, 68, 0.15)"
          : "rgba(99, 102, 241, 0.15)",
        line: {
          color: lowScore
            ? "rgba(239, 68, 68, 0.8)"
            : "rgba(99, 102, 241, 0.6)",
        },
        hovertemplate: "%{theta}: %{r:.2f}σ<extra></extra>",
      }]}
      layout={{
        polar: {
          radialaxis: { visible: true, range: [0, 3] },
        },
        margin: { t: 30, r: 30, b: 30, l: 30 },
        autosize: true,
        paper_bgcolor: "transparent",
        font: { size: 10 },
      }}
      config={{ responsive: true, displayModeBar: false }}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}


// ============================================================
// Step 2 result panel
// ============================================================

function Step2ResultPanel({ result }: { result: Step2bResponse }) {
  const scores = result.scores;

  // Selected date state — default: date with lowest health score (most meaningful for diagnosis)
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    // result가 변경될 때마다 초기 선택 날짜를 재계산.
    // result 의존성만 사용하는 이유: scores/selectedDate를 추가하면 무한 루프 발생.
    if (!selectedDate && scores.length > 0) {
      // deviation이 있는 경우: composite_z가 가장 높은 날짜로 초기 선택 (이상 탐지 포인트)
      const withDeviation = [...scores].filter((s) => s.deviation_eta != null);
      if (withDeviation.length > 0) {
        const highest = withDeviation.sort((a, b) => {
          const zA = Math.abs(a.deviation_eta ?? 0) * 0.5 + Math.abs(a.deviation_v_std ?? 0) * 0.3 + Math.abs(a.deviation_t_eff ?? 0) * 0.2;
          const zB = Math.abs(b.deviation_eta ?? 0) * 0.5 + Math.abs(b.deviation_v_std ?? 0) * 0.3 + Math.abs(b.deviation_t_eff ?? 0) * 0.2;
          return zB - zA;
        })[0];
        setSelectedDate(highest?.date ?? scores.at(-1)?.date ?? null);
      } else {
        setSelectedDate(scores.at(-1)?.date ?? null);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const selectedPoint = scores.find((s) => s.date === selectedDate) ?? null;

  // composite_z 계산 헬퍼
  const computeCompositeZ = (s: Step2bScorePoint) =>
    Math.abs(s.deviation_eta ?? 0) * 0.5 +
    Math.abs(s.deviation_v_std ?? 0) * 0.3 +
    Math.abs(s.deviation_t_eff ?? 0) * 0.2;

  // Summary stats (deviation 기반)
  const latestScore     = [...scores].reverse().find((s) => s.deviation_eta != null);
  const compositeZ      = latestScore ? computeCompositeZ(latestScore) : 0;
  const stableDays      = scores.filter((s) => computeCompositeZ(s) < 1.0).length;
  const elevatedDays    = scores.filter((s) => { const z = computeCompositeZ(s); return z >= 1.0 && z < 2.0; }).length;
  const anomalousDays   = scores.filter((s) => computeCompositeZ(s) >= 2.0).length;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {/* Current Deviation: 최신 composite Z-score 및 상태 */}
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Current Deviation</p>
            <div className="flex items-center gap-2">
              {/* 방향 화살표: composite_z 값에 따른 상태 표시 */}
              <span className={`text-2xl font-bold tabular-nums ${
                compositeZ >= 2.0 ? "text-red-600" :
                compositeZ >= 1.0 ? "text-yellow-600" : "text-green-600"
              }`}>
                {compositeZ.toFixed(2)}
              </span>
              <span className="text-xs text-muted-foreground">|Z|</span>
            </div>
            <Badge
              variant={
                compositeZ >= 2.0 ? "destructive" :
                compositeZ >= 1.0 ? "secondary" : "default"
              }
              className="text-xs mt-1"
            >
              {compositeZ >= 2.0 ? "Anomalous" : compositeZ >= 1.0 ? "Elevated" : "Stable"}
            </Badge>
          </CardContent>
        </Card>

        {/* Baseline Window: 알고리즘 파라미터 요약 */}
        <Card className="border-indigo-200 bg-indigo-50/30 dark:bg-indigo-950/20">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Baseline Window</p>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>MA baseline window</span>
                <span className="font-mono font-semibold text-blue-600">30 days</span>
              </div>
              <div className="flex justify-between text-xs">
                <span>σ rolling window</span>
                <span className="font-mono font-semibold text-indigo-600">90 days</span>
              </div>
              <div className="flex justify-between text-xs">
                <span>Anomalous threshold</span>
                <span className="font-mono text-red-600">|Z| ≥ 2.0</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Deviation Statistics */}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-2">Deviation Statistics</p>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-green-600">Stable (|Z| &lt; 1.0)</span>
                <span className="font-mono">{stableDays} days</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-yellow-600">Elevated (1.0–2.0)</span>
                <span className="font-mono">{elevatedDays} days</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-red-600">Anomalous (≥ 2.0)</span>
                <span className="font-mono font-semibold">{anomalousDays} days</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dual-panel trend chart (2/3) + Radar chart (1/3) */}
      <div className="grid grid-cols-3 gap-4">
        {/* Trend dual-panel chart */}
        <Card className="col-span-2">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Trend Deviation</CardTitle>
            <p className="text-xs text-muted-foreground">
              <span className="text-indigo-500 font-medium">Top</span>: per-feature Z-score deviation (±direction, MA30 baseline).{" "}
              <span className="text-indigo-500 font-medium">Bottom</span>: Composite |Z| = |η|×0.5 + |v_std|×0.3 + |t_eff|×0.2 (weighted anomaly magnitude).{" "}
              <span className="text-yellow-600 font-medium">Yellow dashed</span> = Elevated (|Z|≥1.0),{" "}
              <span className="text-red-500 font-medium">Red dashed</span> = Anomalous (|Z|≥2.0).
              Hover on a date to update the radar chart.
            </p>
          </CardHeader>
          {/* Combined height for top + bottom panels */}
          <CardContent className="h-96 px-2 pb-2">
            <TrendHealthChart result={result} onDateSelect={setSelectedDate} />
          </CardContent>
        </Card>

        {/* Per-feature score Radar Chart */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Trend Deviation Radar</CardTitle>
            <p className="text-xs text-muted-foreground">
              {selectedDate ?? "Hover to select a date"}
              {selectedPoint && (() => {
                const z = Math.abs(selectedPoint.deviation_eta ?? 0) * 0.5
                        + Math.abs(selectedPoint.deviation_v_std ?? 0) * 0.3
                        + Math.abs(selectedPoint.deviation_t_eff ?? 0) * 0.2;
                if (z < 1.0) return <span className="text-green-600"> (Stable)</span>;
                if (z >= 2.0) return <span className="text-red-600"> (Anomalous — inspect root cause)</span>;
                return null;
              })()}
            </p>
          </CardHeader>
          <CardContent className="h-80 px-2 pb-2">
            <FeatureScoreRadar point={selectedPoint} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


// ============================================================
// Page root
// ============================================================

export default function Step2Page({ params }: Step2PageProps) {
  const { id } = use(params);

  const { data: well } = useWell(id);
  const currentStatus  = well?.analysis_status ?? "no_data";

  // Fetch results only after Step 2 is complete (health_done)
  const stepComplete = isStepComplete(currentStatus, 2);
  const { data: result, isLoading: resultLoading } = useStep2Result(id, stepComplete);

  // 분석 결과가 있을 때만 시스템 프롬프트 생성
  const systemPrompt = result
    ? buildStep2SystemPrompt({ wellName: well?.name ?? id, result })
    : "";

  // 최신 건강 상태 — CRITICAL이면 ChatbotTrigger에 배지 표시
  const latestStatus = result
    ? ([...result.scores].reverse().find((s) => s.health_status != null)?.health_status ?? null)
    : null;

  return (
    // step-result-area: html2canvas가 이 영역을 캡처해 vision 챗봇에 전달
    <div id="step-result-area" className="p-4 space-y-4">
      {/* Workflow guard: requires diagnosis_done to run Step 2 */}
      <WorkflowGuard status={currentStatus} requiredStep={2} wellId={id}>

        {/* Header: title + run button + AI 질문 버튼 */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">
              Step 2. Trend Analysis
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              EWMA(span=7) vs MA30 baseline → signed Z-score deviation per feature (η, v_std, t_eff).{" "}
              Slope overlay shows recent 30-day trend direction. Radar chart for relative deviation comparison.
            </p>
          </div>
          {/* 우측: 실행 버튼 + AI 질문 버튼 */}
          <div className="flex items-center gap-2 shrink-0">
            <AnalysisRunButton wellId={id} step={2} />
            {/* Critical 상태면 빨간 배지 표시 */}
            <ChatbotTrigger
              disabled={!result}
              alarmStatus={latestStatus}
            />
          </div>
        </div>

        {/* 챗봇 패널 (Sheet) */}
        {result && (
          <ChatbotPanel
            stepNumber={2}
            wellId={id}
            systemPrompt={systemPrompt}
            initialMessage="Step 2 건강 점수 분석 결과를 요약하고 현재 ESP 상태를 평가해주세요."
          />
        )}

        {/* Loading skeleton */}
        {resultLoading && stepComplete && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="col-span-2 h-96 rounded-lg" />
              <Skeleton className="h-96 rounded-lg" />
            </div>
          </div>
        )}

        {/* Analysis results */}
        {result && <Step2ResultPanel result={result as Step2bResponse} />}
      </WorkflowGuard>
    </div>
  );
}
