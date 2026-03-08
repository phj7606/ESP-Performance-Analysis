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

// Disable Plotly SSR (prevents window object access errors in Next.js Turbopack)
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface Step2PageProps {
  params: Promise<{ id: string }>;
}

// ============================================================
// Health status color utilities
// ============================================================

function getStatusColor(status: string | null): string {
  switch (status) {
    case "Normal":    return "text-green-600";
    case "Degrading": return "text-yellow-600";
    case "Critical":  return "text-red-600";
    default:          return "text-muted-foreground";
  }
}

function getStatusBadgeVariant(status: string | null): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "Normal":    return "default";
    case "Degrading": return "secondary";
    case "Critical":  return "destructive";
    default:          return "outline";
  }
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
 *   - Green = Normal, Yellow = Degrading, Red = Critical
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
  const values = scores.map((s) => s.health_score);

  // Health status color array for composite score markers
  const markerColors = scores.map((s) => {
    if ((s.health_score ?? 100) >= 70) return "rgba(34, 197, 94, 0.7)";
    if ((s.health_score ?? 100) >= 40) return "rgba(234, 179, 8, 0.8)";
    return "rgba(239, 68, 68, 0.8)";
  });

  // Per-feature score trajectories
  const scoreEtaVals  = scores.map((s) => s.score_eta);
  const scoreVstdVals = scores.map((s) => s.score_v_std);
  const scoreTeffVals = scores.map((s) => s.score_t_eff);

  return (
    <Plot
      data={[
        // ── Top subplot: per-feature score trajectories ──
        {
          x: dates, y: scoreEtaVals,
          type: "scatter", mode: "lines",
          name: "Efficiency (η_proxy)",
          line: { color: "rgba(99, 102, 241, 0.7)", width: 1.5 },
          hovertemplate: "η_proxy score: %{y:.1f}<extra></extra>",
          xaxis: "x", yaxis: "y",
        },
        {
          x: dates, y: scoreVstdVals,
          type: "scatter", mode: "lines",
          name: "Vibration (v_std)",
          line: { color: "rgba(249, 115, 22, 0.7)", width: 1.5 },
          hovertemplate: "v_std score: %{y:.1f}<extra></extra>",
          xaxis: "x", yaxis: "y",
        },
        {
          x: dates, y: scoreTeffVals,
          type: "scatter", mode: "lines",
          name: "Cooling (t_eff)",
          line: { color: "rgba(20, 184, 166, 0.7)", width: 1.5 },
          hovertemplate: "t_eff score: %{y:.1f}<extra></extra>",
          xaxis: "x", yaxis: "y",
        },
        // ── Bottom subplot: composite health score ──
        {
          x: dates, y: values,
          type: "scatter", mode: "lines+markers",
          name: "Composite Score",
          line: { color: "rgba(99, 102, 241, 0.5)", width: 1 },
          marker: { color: markerColors, size: 4 },
          hovertemplate: "Date: %{x}<br>Score: %{y:.1f}<extra></extra>",
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
          // Degrading threshold (bottom panel, 70pt)
          {
            type: "line" as const, xref: "paper" as const, yref: "y2" as const,
            x0: 0, x1: 1, y0: 70, y1: 70,
            line: { color: "rgba(234, 179, 8, 0.6)", dash: "dot" as const, width: 1.5 },
          },
          // Critical threshold (bottom panel, 40pt) — RUL trigger
          {
            type: "line" as const, xref: "paper" as const, yref: "y2" as const,
            x0: 0, x1: 1, y0: 40, y1: 40,
            line: { color: "rgba(239, 68, 68, 0.7)", dash: "dot" as const, width: 2 },
          },
        ],
        annotations: [
          {
            x: 0.01, y: 71, xref: "paper" as const, yref: "y2" as const,
            text: "Degrading (70)", showarrow: false,
            font: { size: 9, color: "rgba(234, 179, 8, 0.8)" },
            xanchor: "left" as const, yanchor: "bottom" as const,
          },
          {
            x: 0.01, y: 41, xref: "paper" as const, yref: "y2" as const,
            text: "Critical (40) — RUL threshold", showarrow: false,
            font: { size: 9, color: "rgba(239, 68, 68, 0.8)" },
            xanchor: "left" as const, yanchor: "bottom" as const,
          },
        ],
        // Top subplot axes — 기준 x축 (bottom panel이 이 축을 따름)
        xaxis:  { type: "date", showticklabels: false },
        yaxis:  { title: { text: "Per-Feature Score" }, range: [0, 110] },
        // Bottom subplot axes — matches: 'x' 로 top panel x축과 줌/팬 연동
        xaxis2: { title: { text: "Date" }, type: "date", matches: "x" },
        yaxis2: { title: { text: "Composite Health Score" }, range: [0, 110] },
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
      // Hover: pass selected date to parent → Radar chart update
      onHover={(event: any) => {
        const date = event.points[0]?.x as string;
        if (date) onDateSelect(date);
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
  if (!point || point.score_eta == null) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Hover over the chart to select a date
      </div>
    );
  }

  const eta   = point.score_eta   ?? 100;
  const vstd  = point.score_v_std ?? 100;
  const teff  = point.score_t_eff ?? 100;
  const score = point.health_score ?? 100;

  // Danger color when score drops below 60
  const lowScore = score < 60;

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
        hovertemplate: "%{theta}: %{r:.1f}pt<extra></extra>",
      }]}
      layout={{
        polar: {
          radialaxis: { visible: true, range: [0, 100] },
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
    if (!selectedDate && scores.length > 0) {
      const lowest = [...scores]
        .filter((s) => s.health_score != null)
        .sort((a, b) => (a.health_score ?? 100) - (b.health_score ?? 100))[0];
      setSelectedDate(lowest?.date ?? scores.at(-1)?.date ?? null);
    }
  }, [result]);

  const selectedPoint = scores.find((s) => s.date === selectedDate) ?? null;

  // Summary stats
  const latestScore   = [...scores].reverse().find((s) => s.health_score != null);
  const criticalDays  = scores.filter((s) => (s.health_score ?? 100) < 40).length;
  const degradingDays = scores.filter(
    (s) => (s.health_score ?? 100) >= 40 && (s.health_score ?? 100) < 70
  ).length;
  const normalDays = scores.filter((s) => (s.health_score ?? 100) >= 70).length;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {/* Latest health score */}
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Current Health Score (Trend-Residual)</p>
            <div className="flex items-end gap-2">
              <span className={`text-2xl font-bold tabular-nums ${
                getStatusColor(latestScore?.health_status ?? null)
              }`}>
                {latestScore?.health_score?.toFixed(1) ?? "—"}
              </span>
              <span className="text-xs text-muted-foreground mb-0.5">/ 100</span>
            </div>
            {latestScore?.health_status && (
              <Badge
                variant={getStatusBadgeVariant(latestScore.health_status)}
                className="text-xs mt-1"
              >
                {latestScore.health_status}
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* Algorithm parameter summary */}
        <Card className="border-indigo-200 bg-indigo-50/30 dark:bg-indigo-950/20">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Penalty Structure</p>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>Residual penalty (P_res)</span>
                <span className="font-mono font-semibold text-yellow-600">≤ 40pt</span>
              </div>
              <div className="flex justify-between text-xs">
                <span>Slope penalty (P_slope)</span>
                <span className="font-mono font-semibold text-red-600">≤ 60pt</span>
              </div>
              <div className="flex justify-between text-xs">
                <span>Score floor (SCORE_FLOOR)</span>
                <span className="font-mono">10pt</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Days per status */}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-2">Days by Status</p>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-green-600">Normal (≥70)</span>
                <span className="font-mono">{normalDays} days</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-yellow-600">Degrading (40–70)</span>
                <span className="font-mono">{degradingDays} days</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-red-600">Critical (&lt;40)</span>
                <span className="font-mono font-semibold">{criticalDays} days</span>
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
            <CardTitle className="text-sm">Trend-Residual Health Score</CardTitle>
            <p className="text-xs text-muted-foreground">
              <span className="text-indigo-500 font-medium">Top</span>: per-feature score trajectories.{" "}
              <span className="text-indigo-500 font-medium">Bottom</span>: weighted composite score.{" "}
              <span className="text-yellow-600 font-medium">Yellow dashed</span> = Degrading (70),{" "}
              <span className="text-red-500 font-medium">Red dashed</span> = Critical (40, RUL trigger).
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
            <CardTitle className="text-sm">Feature Health Scores</CardTitle>
            <p className="text-xs text-muted-foreground">
              {selectedDate ?? "Hover to select a date"}
              {selectedPoint && (selectedPoint.health_score ?? 100) >= 70 && (
                <span className="text-green-600"> (Normal range)</span>
              )}
              {selectedPoint && (selectedPoint.health_score ?? 100) < 40 && (
                <span className="text-red-600"> (Critical — inspect root cause)</span>
              )}
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

  return (
    <div className="p-4 space-y-4">
      {/* Workflow guard: requires diagnosis_done to run Step 2 */}
      <WorkflowGuard status={currentStatus} requiredStep={2} wellId={id}>

        {/* Header: title + run button */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">
              Step 2. Health Score (Trend-Residual)
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              EWMA(span=7) → MA30 baseline deviation penalty (≤40pt) + slope penalty (≤60pt) →{" "}
              Health score 10–100. Radar chart for root cause identification.
            </p>
          </div>
          {/* Standard run button — uses normal workflow state transition */}
          <AnalysisRunButton wellId={id} step={2} />
        </div>

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
