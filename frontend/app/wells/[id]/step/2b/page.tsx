"use client";

/**
 * SCR-005b: Step 2-B — Health Score (GMM — Supplementary) Page
 *
 * Algorithm:
 * 1. Step 1 residuals (eta_proxy, v_std, t_eff) → EWMA(span=7) → log transform + Standard Scaling
 * 2. Rolling GMM (Expanding 30-day → Rolling 60-day window)
 * 3. Log-Likelihood piecewise normalization:
 *    p20+ → 80–100pt (stable normal operation)
 *    p2–p20 → 40–80pt (early-to-mid degradation)
 *    <p2 → 0–40pt (severe degradation)
 * 4. Feature contribution: squared deviation ratio from normal component mean (sums to 1.0)
 *
 * Visualization:
 * - Health score time series (hover → Contribution Radar Chart update)
 * - Contribution Radar: Efficiency / Vibration / Cooling contribution ratios
 *
 * UX flow:
 * 1. Click "Run Step 2-B Analysis" → Celery async task → task_id polling
 * 2. On completion: health score time series + contribution radar rendered
 *
 * Note: Step 2-B is supplementary — does NOT update workflow status or latest_health_score.
 *       Accessible after Step 1 (diagnosis_done), independent of Step 2.
 */

import { use, useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Play, Loader2, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkflowGuard } from "@/components/analysis/WorkflowGuard";
import { useWell } from "@/hooks/useWell";
import { useStep2bResult } from "@/hooks/useAnalysis";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import { useQueryClient } from "@tanstack/react-query";
import { isStepComplete } from "@/lib/workflow";
import { runStep2b } from "@/lib/api";
import type { Step2Response, Step2HealthPoint } from "@/lib/api";

// Disable Plotly SSR (prevents window object access errors in Next.js Turbopack)
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface Step2bPageProps {
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

function getStatusBadgeVariant(
  status: string | null
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "Normal":    return "default";
    case "Degrading": return "secondary";
    case "Critical":  return "destructive";
    default:          return "outline";
  }
}


// ============================================================
// Step 2-B run button (local state, no workflow store)
// ============================================================

/**
 * Step 2-B dedicated run/polling button.
 *
 * Uses local useState for task_id — supplementary analysis does not
 * update global workflow state. Re-run is required on page re-visit.
 */
function Step2bRunButton({ wellId }: { wellId: string }) {
  const queryClient = useQueryClient();
  const [taskId, setTaskId]   = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Poll Celery task status (inactive when no taskId)
  const { data: task } = useTaskPolling(taskId);

  // Invalidate result cache on task completion
  useEffect(() => {
    if (task?.status === "SUCCESS") {
      queryClient.invalidateQueries({ queryKey: ["stepResult", wellId, "2b"] });
      queryClient.invalidateQueries({ queryKey: ["well", wellId] });
    }
  }, [task?.status, wellId, queryClient]);

  const handleRun = useCallback(async () => {
    try {
      setRunning(true);
      setTaskId(null);
      const { task_id } = await runStep2b(wellId);
      setTaskId(task_id);
    } catch (err) {
      console.error("Step 2-B run failed:", err);
    } finally {
      setRunning(false);
    }
  }, [wellId]);

  const handleRerun = () => {
    setTaskId(null);
    handleRun();
  };

  const isPolling = task?.status === "PENDING" || task?.status === "STARTED";
  const isSuccess = task?.status === "SUCCESS";
  const isFailure = task?.status === "FAILURE";

  // Completed state
  if (isSuccess) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          Analysis complete
        </div>
        <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={handleRerun}>
          <RefreshCw className="h-3 w-3" />
          Re-run
        </Button>
      </div>
    );
  }

  // Failed state
  if (isFailure) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm text-destructive">
          <XCircle className="h-4 w-4" />
          Analysis failed
        </div>
        <Button variant="outline" size="sm" className="h-7 gap-1" onClick={handleRerun}>
          <RefreshCw className="h-3 w-3" />
          Retry
        </Button>
      </div>
    );
  }

  // Running / polling state
  if (running || isPolling) {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">
          {isPolling && task?.status === "PENDING" ? "Queued..." : "Analyzing..."}
        </span>
      </div>
    );
  }

  // Default run button
  return (
    <Button size="sm" className="gap-1.5" onClick={handleRun}>
      <Play className="h-3.5 w-3.5" />
      Run Step 2-B (GMM)
    </Button>
  );
}


// ============================================================
// Health score time series chart (hover → Radar Chart update)
// ============================================================

/**
 * GMM health score time series.
 *
 * - Baseline window: blue background (most recent Rolling Baseline)
 * - Score color: Normal(green) / Degrading(yellow) / Critical(red)
 * - Threshold lines: 70 (Degrading boundary), 40 (Critical / RUL trigger)
 * - onHover: passes selected date to parent → updates Contribution Radar
 */
function HealthScoreChart({
  result,
  onDateSelect,
}: {
  result: Step2Response;
  onDateSelect: (date: string) => void;
}) {
  const scores = result.scores;
  const dates  = scores.map((s) => s.date);
  const values = scores.map((s) => s.health_score);

  // Color per health status
  const markerColors = scores.map((s) => {
    if ((s.health_score ?? 100) >= 70) return "rgba(34, 197, 94, 0.7)";
    if ((s.health_score ?? 100) >= 40) return "rgba(234, 179, 8, 0.8)";
    return "rgba(239, 68, 68, 0.8)";
  });

  return (
    <Plot
      data={[
        {
          x: dates, y: values,
          type: "scatter", mode: "lines+markers",
          name: "Health Score",
          line: { color: "rgba(147, 51, 234, 0.6)", width: 1 },
          marker: { color: markerColors, size: 4 },
          hovertemplate: "Date: %{x}<br>Score: %{y:.1f}<extra></extra>",
        },
      ]}
      layout={{
        shapes: [
          // Rolling baseline window background
          ...(result.training_start && result.training_end ? [{
            type: "rect" as const,
            xref: "x" as const, yref: "paper" as const,
            x0: result.training_start, x1: result.training_end,
            y0: 0, y1: 1,
            fillcolor: "rgba(59, 130, 246, 0.07)",
            line: { width: 0 }, layer: "below" as const,
          }] : []),
          // Degrading threshold (70pt)
          {
            type: "line" as const, xref: "paper" as const, yref: "y" as const,
            x0: 0, x1: 1, y0: 70, y1: 70,
            line: { color: "rgba(234, 179, 8, 0.6)", dash: "dot" as const, width: 1.5 },
          },
          // Critical threshold (40pt) — RUL trigger
          {
            type: "line" as const, xref: "paper" as const, yref: "y" as const,
            x0: 0, x1: 1, y0: 40, y1: 40,
            line: { color: "rgba(239, 68, 68, 0.7)", dash: "dot" as const, width: 2 },
          },
        ],
        annotations: [
          ...(result.training_start ? [{
            x: result.training_start,
            y: 105, xref: "x" as const, yref: "y" as const,
            text: "Rolling Baseline start",
            showarrow: false,
            font: { size: 9, color: "rgba(59, 130, 246, 0.8)" },
            xanchor: "left" as const,
          }] : []),
          {
            x: 0.01, y: 71, xref: "paper" as const, yref: "y" as const,
            text: "Degrading (70)", showarrow: false,
            font: { size: 9, color: "rgba(234, 179, 8, 0.8)" },
            xanchor: "left" as const, yanchor: "bottom" as const,
          },
          {
            x: 0.01, y: 41, xref: "paper" as const, yref: "y" as const,
            text: "Critical (40) — RUL threshold", showarrow: false,
            font: { size: 9, color: "rgba(239, 68, 68, 0.8)" },
            xanchor: "left" as const, yanchor: "bottom" as const,
          },
        ],
        xaxis: { title: { text: "Date" }, type: "date" },
        yaxis: { title: { text: "Health Score (0–100)" }, range: [0, 110] },
        margin: { t: 20, r: 20, b: 50, l: 70 },
        autosize: true,
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        font: { size: 10 },
        hovermode: "x unified",
      }}
      config={{ responsive: true, displayModeBar: false }}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      // Hover: pass selected date to parent → update Contribution Radar
      onHover={(event: any) => {
        const date = event.points[0]?.x as string;
        if (date) onDateSelect(date);
      }}
    />
  );
}


// ============================================================
// Feature contribution Radar Chart
// ============================================================

/**
 * Feature contribution Radar Chart (Plotly Scatterpolar).
 *
 * 3 axes: Efficiency (η_proxy), Vibration (v_std), Cooling (t_eff)
 * Values: contribution ratios (0–100%)
 * Note: contributions are only meaningful when health score is low (degrading/critical).
 */
function ContributionRadarChart({
  point,
}: {
  point: Step2HealthPoint | null;
}) {
  // Show placeholder if no data
  if (!point || point.contribution_eta == null) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Hover on the health score chart to select a date
      </div>
    );
  }

  const eta   = (point.contribution_eta   ?? 1 / 3) * 100;
  const vstd  = (point.contribution_v_std ?? 1 / 3) * 100;
  const teff  = (point.contribution_t_eff ?? 1 / 3) * 100;
  const score = point.health_score ?? 100;

  // Meaningful contribution analysis only when score is degrading
  const lowScore = score < 70;

  return (
    <Plot
      data={[{
        type: "scatterpolar",
        // Closed polygon: repeat first point at end
        r: [eta, vstd, teff, eta],
        theta: ["Efficiency (η)", "Vibration (v_std)", "Cooling (t_eff)", "Efficiency (η)"],
        fill: "toself",
        fillcolor: lowScore ? "rgba(147, 51, 234, 0.15)" : "rgba(99, 102, 241, 0.15)",
        line: { color: lowScore ? "rgba(147, 51, 234, 0.8)" : "rgba(99, 102, 241, 0.6)" },
        hovertemplate: "%{theta}: %{r:.1f}%<extra></extra>",
      }]}
      layout={{
        polar: {
          radialaxis: { visible: true, range: [0, 100], ticksuffix: "%" },
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
// Step 2-B result panel
// ============================================================

function Step2bResultPanel({ result }: { result: Step2Response }) {
  const scores = result.scores;

  // Selected date state — default: date with lowest health score
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedDate) {
      const lowest = [...scores]
        .filter((s) => s.health_score != null)
        .sort((a, b) => (a.health_score ?? 100) - (b.health_score ?? 100))[0];
      setSelectedDate(lowest?.date ?? scores.at(-1)?.date ?? null);
    }
  }, [result]);

  // Selected date data point (Radar Chart input)
  const selectedPoint = scores.find((s) => s.date === selectedDate) ?? null;

  // Summary stats
  const latestScore   = [...scores].reverse().find((s) => s.health_score != null);
  const criticalDays  = scores.filter((s) => (s.health_score ?? 100) < 40).length;
  const degradingDays = scores.filter(
    (s) => (s.health_score ?? 100) >= 40 && (s.health_score ?? 100) < 70
  ).length;

  // Mahalanobis column is always null in GMM-LL mode; hide chart when so
  const hasMahalanobis = scores.some((s) => s.mahalanobis_distance != null);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {/* Latest health score */}
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Current Health Score (GMM)</p>
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

        {/* Rolling Baseline window info */}
        <Card className="border-purple-200 bg-purple-50/30 dark:bg-purple-950/20">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Rolling Baseline Window (60 days)</p>
            <p className="text-xs font-mono font-semibold">
              {result.training_start ?? "—"}
            </p>
            <p className="text-xs text-muted-foreground">~</p>
            <p className="text-xs font-mono font-semibold">
              {result.training_end ?? "—"}
            </p>
            <div className="flex flex-wrap gap-1 mt-2">
              {result.features_used.map((f) => (
                <Badge key={f} variant="outline" className="text-xs py-0">
                  {f.replace("log_", "")}
                </Badge>
              ))}
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
                <span className="font-mono">
                  {scores.filter((s) => (s.health_score ?? 100) >= 70).length} days
                </span>
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

      {/* Health score time series (2/3) + Contribution Radar (1/3) */}
      <div className="grid grid-cols-3 gap-4">
        {/* Health score time series */}
        <Card className="col-span-2">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">GMM Health Score</CardTitle>
            <p className="text-xs text-muted-foreground">
              <span className="text-blue-500 font-medium">Blue background</span> = Rolling Baseline window.{" "}
              <span className="text-yellow-600 font-medium">Yellow dashed</span> = Degrading (70).{" "}
              <span className="text-red-500 font-medium">Red dashed</span> = Critical (40, RUL trigger).
              Hover on a date to update the contribution radar.
            </p>
          </CardHeader>
          <CardContent className="h-72 px-2 pb-2">
            <HealthScoreChart result={result} onDateSelect={setSelectedDate} />
          </CardContent>
        </Card>

        {/* Feature contribution Radar Chart */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Contribution Analysis</CardTitle>
            {/* Selected date + normal range warning */}
            <p className="text-xs text-muted-foreground">
              {selectedDate ?? "Hover to select a date"}
              {selectedPoint && (selectedPoint.health_score ?? 100) >= 70 && (
                <span className="text-yellow-600"> (Score in normal range)</span>
              )}
            </p>
          </CardHeader>
          <CardContent className="h-56 px-2 pb-2">
            <ContributionRadarChart point={selectedPoint} />
          </CardContent>
        </Card>
      </div>

      {/* Mahalanobis distance chart: shown only when data exists (always hidden in GMM-LL mode) */}
      {hasMahalanobis && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Mahalanobis Distance</CardTitle>
            <p className="text-xs text-muted-foreground">
              Statistical distance from the normal cluster. Higher distance = more anomalous operation.
            </p>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}


// ============================================================
// Page root
// ============================================================

export default function Step2bPage({ params }: Step2bPageProps) {
  const { id } = use(params);

  const { data: well } = useWell(id);
  const currentStatus  = well?.analysis_status ?? "no_data";

  // Enable result fetch once Step 1 is complete (diagnosis_done)
  // Step 2-B (GMM) is supplementary and doesn't update workflow status
  const step1Done = isStepComplete(currentStatus, 1);
  const { data: result, isLoading: resultLoading } = useStep2bResult(id, step1Done);

  return (
    <div className="p-4 space-y-4">
      {/* Workflow guard: requires Step 1 (diagnosis_done) — Step 2 not required */}
      <WorkflowGuard status={currentStatus} requiredStep={2} wellId={id}>

        {/* Header: title + run button */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">
              Step 2-B. Health Score (GMM — Supplementary)
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              EWMA(span=7) → Rolling GMM (60-day window) + Log-Likelihood piecewise normalization →{" "}
              Health score 0–100. Contribution radar for feature-level root cause analysis.
              Supplementary analysis — does not affect workflow status.
            </p>
          </div>
          {/* Step 2-B dedicated run button (no workflow state change) */}
          <Step2bRunButton wellId={id} />
        </div>

        {/* Loading skeleton */}
        {resultLoading && step1Done && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="col-span-2 h-72 rounded-lg" />
              <Skeleton className="h-72 rounded-lg" />
            </div>
          </div>
        )}

        {/* Analysis results */}
        {result && <Step2bResultPanel result={result as Step2Response} />}

        {/* No results yet message */}
        {!resultLoading && !result && step1Done && (
          <div className="flex flex-col items-center justify-center min-h-48 text-center gap-2">
            <p className="text-sm text-muted-foreground">
              GMM analysis has not been run yet.
            </p>
            <p className="text-xs text-muted-foreground">
              Click &ldquo;Run Step 2-B (GMM)&rdquo; above to start.
            </p>
          </div>
        )}
      </WorkflowGuard>
    </div>
  );
}
