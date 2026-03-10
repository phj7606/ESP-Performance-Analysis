"use client";

/**
 * SCR-006: Step 3 — 3-Pillar 독립 고장 모드 알람 모니터링
 *
 * 설계 원칙:
 * - 3개 고장 모드를 혼합 없이 독립 판정
 * - 예지 날짜(RUL 수치) 없음 — "지금 이 지표가 위험한가?" 직접 판단
 * - 각 Pillar는 자체 지표와 알람 기준을 가짐
 *
 * Pillar 1 (Hydraulic):  ψ_ma30 Mann-Kendall 하락 추세 + 시계열 차트
 * Pillar 2 (Mechanical): v_std_ma30 Mann-Kendall 상승 추세 + 시계열 차트
 * Pillar 3 (Electrical): current_leak 절대값 + 3일 지속 조건
 */

import { use } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, CheckCircle2, HelpCircle,
  TrendingDown, TrendingUp, Zap,
} from "lucide-react";
import { WorkflowGuard } from "@/components/analysis/WorkflowGuard";
import { AnalysisRunButton } from "@/components/analysis/AnalysisRunButton";
import { useWell } from "@/hooks/useWell";
import { useStep1Result, useStep3Result } from "@/hooks/useAnalysis";
import { useWellData } from "@/hooks/useWellData";
import { isStepComplete } from "@/lib/workflow";
import type { Step3Response, PillarAlarm, Pillar3Alarm, Step1IndexPoint, EspDataPoint } from "@/lib/api";
// 챗봇 컴포넌트 및 프롬프트 빌더
import { ChatbotTrigger } from "@/components/chatbot/ChatbotTrigger";
import { ChatbotPanel } from "@/components/chatbot/ChatbotPanel";
import { buildStep3SystemPrompt } from "@/lib/chatbot-prompts";

// Plotly SSR disabled — Next.js Turbopack does not support window access during SSR
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface Step3PageProps {
  params: Promise<{ id: string }>;
}

// Mann-Kendall window (same constant as backend — used for chart highlight range)
const MK_WINDOW = 60;


// ============================================================
// 알람 배지
// ============================================================

function AlarmBadge({ status }: { status: string | null }) {
  if (!status || status === "unknown") {
    return (
      <Badge variant="outline" className="gap-1 border-gray-400 text-gray-500">
        <HelpCircle className="h-3 w-3" />
        No Data
      </Badge>
    );
  }
  if (status === "critical") {
    return (
      <Badge variant="destructive" className="gap-1 text-sm px-3 py-1">
        <AlertTriangle className="h-4 w-4" />
        CRITICAL
      </Badge>
    );
  }
  if (status === "warning") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400 text-sm px-3 py-1"
      >
        <AlertTriangle className="h-4 w-4" />
        WARNING
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-green-500 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 text-sm px-3 py-1"
    >
      <CheckCircle2 className="h-4 w-4" />
      NORMAL
    </Badge>
  );
}


// ============================================================
// 공통 추세 차트 (Pillar 1 / 2 공유)
// ============================================================

/**
 * Time-series chart for ψ_ma30 or v_std_ma30.
 *
 * Layout:
 * - Full history (thin gray line — background context)
 * - Recent MK_WINDOW (60 days) highlighted with alarm color
 * - Baseline horizontal line (blue dotted)
 * - CRITICAL threshold line (red dotted)
 */
function PillarTrendChart({
  indices,
  colKey,
  pillar,
  direction,
}: {
  indices: Step1IndexPoint[];
  /** "psi_ma30" | "v_std_ma30" */
  colKey: "psi_ma30" | "v_std_ma30";
  pillar: PillarAlarm;
  /** "down": 하락 위험(P1), "up": 상승 위험(P2) */
  direction: "down" | "up";
}) {
  // Filter nulls and extract date-value pairs
  const all = indices
    .filter((p) => p[colKey] != null)
    .map((p) => ({ date: p.date, val: p[colKey] as number }));

  if (all.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        No time-series data
      </div>
    );
  }

  const allDates = all.map((p) => p.date);
  const allVals  = all.map((p) => p.val);

  // Recent MK_WINDOW slice — matches the Mann-Kendall test window in the backend
  const recent      = all.slice(-MK_WINDOW);
  const recentDates = recent.map((p) => p.date);
  const recentVals  = recent.map((p) => p.val);

  // Accent color by alarm status
  const accentColor =
    pillar.status === "critical" ? "rgba(220,53,69,0.9)" :
    pillar.status === "warning"  ? "rgba(234,88,12,0.9)" :
                                   "rgba(99,102,241,0.9)";

  const shapes: Plotly.Shape[] = [];
  const annotations: Plotly.Annotations[] = [];

  // Baseline horizontal line (blue dotted)
  if (pillar.baseline_val != null) {
    shapes.push({
      type: "line", xref: "paper", yref: "y",
      x0: 0, x1: 1,
      y0: pillar.baseline_val, y1: pillar.baseline_val,
      line: { color: "rgba(59,130,246,0.6)", dash: "dot", width: 1.5 },
    } as Plotly.Shape);
    annotations.push({
      x: 0.01, y: pillar.baseline_val,
      xref: "paper", yref: "y",
      text: `Baseline: ${pillar.baseline_val.toFixed(4)}`,
      showarrow: false,
      font: { size: 9, color: "rgba(59,130,246,0.8)" },
      xanchor: "left", yanchor: "bottom",
    } as Plotly.Annotations);
  }

  // CRITICAL threshold line (red dotted)
  if (pillar.threshold != null) {
    shapes.push({
      type: "line", xref: "paper", yref: "y",
      x0: 0, x1: 1,
      y0: pillar.threshold, y1: pillar.threshold,
      line: { color: "rgba(220,53,69,0.65)", dash: "dot", width: 1.5 },
    } as Plotly.Shape);
    const label = direction === "down"
      ? `Critical: ${pillar.threshold.toFixed(4)} (−20%)`
      : `Critical: ${pillar.threshold.toFixed(4)} (+50%)`;
    annotations.push({
      x: 0.01, y: pillar.threshold,
      xref: "paper", yref: "y",
      text: label,
      showarrow: false,
      font: { size: 9, color: "rgba(220,53,69,0.8)" },
      xanchor: "left",
      yanchor: direction === "down" ? "top" : "bottom",
    } as Plotly.Annotations);
  }

  return (
    <Plot
      data={[
        // Full history (thin gray line — background context)
        {
          x: allDates, y: allVals,
          type: "scatter", mode: "lines",
          name: "Full History",
          line: { color: "rgba(150,150,150,0.4)", width: 1 },
          hoverinfo: "skip",
        },
        // Recent MK_WINDOW days (accent color — MK test window)
        {
          x: recentDates, y: recentVals,
          type: "scatter", mode: "lines",
          name: `Recent ${MK_WINDOW}d (MK window)`,
          line: { color: accentColor, width: 2 },
          hovertemplate: "%{x}<br>Value: %{y:.5f}<extra></extra>",
        },
      ]}
      layout={{
        xaxis: { type: "date", title: { text: "Date" } },
        yaxis: { title: { text: colKey === "psi_ma30" ? "ψ_ma30" : "v_std_ma30" } },
        shapes,
        annotations,
        margin: { t: 10, r: 20, b: 45, l: 80 },
        legend: { orientation: "h", y: -0.3, x: 0 },
        autosize: true,
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        font: { size: 10 },
      }}
      config={{ responsive: true, displayModeBar: false }}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}


// ============================================================
// Pillar 1 panel: Hydraulic performance
// ============================================================

function Pillar1Panel({
  pillar,
  indices,
}: {
  pillar: PillarAlarm;
  indices: Step1IndexPoint[];
}) {
  const borderColor =
    pillar.status === "critical" ? "border-red-300" :
    pillar.status === "warning"  ? "border-orange-300" :
    pillar.status === "normal"   ? "border-green-300" : "border-gray-200";

  return (
    <Card className={`${borderColor} border-2`}>
      <CardHeader className="py-3 px-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-blue-500" />
            <CardTitle className="text-sm">Pillar 1 — Hydraulic Performance</CardTitle>
          </div>
          <AlarmBadge status={pillar.status} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Indicator: ψ_ma30 (dimensionless pump head) · Mann-Kendall downward trend test (last 60 days)
        </p>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-3">
        {/* Numeric indicators */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-xs">Mann-Kendall τ</span>
            <span className={`font-mono font-semibold ${
              pillar.tau != null && pillar.tau < 0 ? "text-orange-600" : "text-foreground"
            }`}>
              {pillar.tau != null ? pillar.tau.toFixed(4) : "—"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-xs">p-value</span>
            <span className={`font-mono font-semibold ${
              pillar.pvalue != null && pillar.pvalue < 0.05 ? "text-orange-600" : "text-foreground"
            }`}>
              {pillar.pvalue != null ? pillar.pvalue.toFixed(4) : "—"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-xs">Current Value (ψ)</span>
            <span className={`font-mono font-semibold ${
              pillar.status === "critical" ? "text-red-600" : "text-foreground"
            }`}>
              {pillar.current_val != null ? pillar.current_val.toFixed(4) : "—"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-xs">Baseline / CRITICAL</span>
            <span className="font-mono text-xs">
              <span className="text-blue-600">{pillar.baseline_val?.toFixed(4) ?? "—"}</span>
              {" / "}
              <span className="text-red-600">{pillar.threshold?.toFixed(4) ?? "—"}</span>
            </span>
          </div>
        </div>

        {/* Time-series chart */}
        <div className="h-52 border rounded bg-background/50">
          {indices.length > 0 ? (
            <PillarTrendChart
              indices={indices}
              colKey="psi_ma30"
              pillar={pillar}
              direction="down"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Loading Step 1 results…
            </div>
          )}
        </div>

        {/* Interpretation text */}
        <div className="pt-1 text-xs border-t border-dashed">
          {pillar.status === "critical" && (
            <p className="text-red-700 dark:text-red-400">
              ψ has dropped more than 20% below baseline. Pump wear or scaling suspected — immediate inspection required.
            </p>
          )}
          {pillar.status === "warning" && (
            <p className="text-orange-700 dark:text-orange-400">
              Significant downward trend detected (τ &lt; 0, p &lt; 0.05). CRITICAL transition expected if trend continues.
            </p>
          )}
          {pillar.status === "normal" && (
            <p className="text-green-700 dark:text-green-400">
              ψ indicator within normal range. No significant downward trend detected.
            </p>
          )}
          {(!pillar.status || pillar.status === "unknown") && (
            <p className="text-muted-foreground">Insufficient data — Step 1 analysis required.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}


// ============================================================
// Pillar 2 panel: Mechanical vibration
// ============================================================

function Pillar2Panel({
  pillar,
  indices,
}: {
  pillar: PillarAlarm;
  indices: Step1IndexPoint[];
}) {
  const borderColor =
    pillar.status === "critical" ? "border-red-300" :
    pillar.status === "warning"  ? "border-orange-300" :
    pillar.status === "normal"   ? "border-green-300" : "border-gray-200";

  return (
    <Card className={`${borderColor} border-2`}>
      <CardHeader className="py-3 px-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-orange-500" />
            <CardTitle className="text-sm">Pillar 2 — Mechanical Vibration</CardTitle>
          </div>
          <AlarmBadge status={pillar.status} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Indicator: v_std_ma30 (dimensionless vibration variance) · Mann-Kendall upward trend test (last 60 days)
        </p>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-3">
        {/* Numeric indicators */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-xs">Mann-Kendall τ</span>
            <span className={`font-mono font-semibold ${
              pillar.tau != null && pillar.tau > 0 ? "text-orange-600" : "text-foreground"
            }`}>
              {pillar.tau != null ? pillar.tau.toFixed(4) : "—"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-xs">p-value</span>
            <span className={`font-mono font-semibold ${
              pillar.pvalue != null && pillar.pvalue < 0.05 ? "text-orange-600" : "text-foreground"
            }`}>
              {pillar.pvalue != null ? pillar.pvalue.toFixed(4) : "—"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-xs">Current Value (v_std)</span>
            <span className={`font-mono font-semibold ${
              pillar.status === "critical" ? "text-red-600" : "text-foreground"
            }`}>
              {pillar.current_val != null ? pillar.current_val.toFixed(4) : "—"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-xs">Baseline / CRITICAL</span>
            <span className="font-mono text-xs">
              <span className="text-blue-600">{pillar.baseline_val?.toFixed(4) ?? "—"}</span>
              {" / "}
              <span className="text-red-600">{pillar.threshold?.toFixed(4) ?? "—"}</span>
            </span>
          </div>
        </div>

        {/* Time-series chart */}
        <div className="h-52 border rounded bg-background/50">
          {indices.length > 0 ? (
            <PillarTrendChart
              indices={indices}
              colKey="v_std_ma30"
              pillar={pillar}
              direction="up"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Loading Step 1 results…
            </div>
          )}
        </div>

        {/* Interpretation text */}
        <div className="pt-1 text-xs border-t border-dashed">
          {pillar.status === "critical" && (
            <p className="text-red-700 dark:text-red-400">
              v_std has risen more than 50% above baseline. Bearing wear or rotor imbalance suspected — immediate inspection required.
            </p>
          )}
          {pillar.status === "warning" && (
            <p className="text-orange-700 dark:text-orange-400">
              Significant upward vibration trend detected (τ &gt; 0, p &lt; 0.05). Early-stage bearing wear possible.
            </p>
          )}
          {pillar.status === "normal" && (
            <p className="text-green-700 dark:text-green-400">
              v_std indicator within normal range. No significant upward trend detected.
            </p>
          )}
          {(!pillar.status || pillar.status === "unknown") && (
            <p className="text-muted-foreground">Insufficient data — Step 1 analysis required.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}


// ============================================================
// Pillar 3 누설 전류 차트
// ============================================================

/**
 * current_leak time-series chart.
 *
 * Layout:
 * - Raw time series (thin gray line)
 * - WARNING threshold at 100μA (orange dotted)
 * - CRITICAL threshold at 1000μA (red dotted)
 */
function LeakTrendChart({
  espData,
  pillar,
}: {
  espData: EspDataPoint[];
  pillar: Pillar3Alarm;
}) {
  const pts = espData
    .filter((p) => p.current_leak != null)
    .map((p) => ({ date: p.date, val: p.current_leak as number }));

  if (pts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        No current_leak data
      </div>
    );
  }

  const accentColor =
    pillar.status === "critical" ? "rgba(220,53,69,0.85)" :
    pillar.status === "warning"  ? "rgba(234,88,12,0.85)" :
                                   "rgba(99,102,241,0.85)";

  return (
    <Plot
      data={[{
        x: pts.map((p) => p.date),
        y: pts.map((p) => p.val),
        type: "scatter",
        mode: "lines",
        name: "current_leak (μA)",
        line: { color: accentColor, width: 1.5 },
        hovertemplate: "%{x}<br>%{y:.2f} μA<extra></extra>",
      }]}
      layout={{
        xaxis: { type: "date", title: { text: "Date" } },
        yaxis: { title: { text: "current_leak (μA)" } },
        shapes: [
          // WARNING 선 100μA
          {
            type: "line", xref: "paper", yref: "y",
            x0: 0, x1: 1, y0: 100, y1: 100,
            line: { color: "rgba(234,88,12,0.6)", dash: "dot", width: 1.5 },
          } as Plotly.Shape,
          // CRITICAL 선 1000μA
          {
            type: "line", xref: "paper", yref: "y",
            x0: 0, x1: 1, y0: 1000, y1: 1000,
            line: { color: "rgba(220,53,69,0.65)", dash: "dot", width: 1.5 },
          } as Plotly.Shape,
        ],
        annotations: [
          {
            x: 0.01, y: 100, xref: "paper", yref: "y",
            text: "WARNING: 100μA",
            showarrow: false,
            font: { size: 9, color: "rgba(234,88,12,0.8)" },
            xanchor: "left", yanchor: "bottom",
          } as Plotly.Annotations,
          {
            x: 0.01, y: 1000, xref: "paper", yref: "y",
            text: "CRITICAL: 1,000μA",
            showarrow: false,
            font: { size: 9, color: "rgba(220,53,69,0.8)" },
            xanchor: "left", yanchor: "bottom",
          } as Plotly.Annotations,
        ],
        margin: { t: 10, r: 20, b: 45, l: 80 },
        autosize: true,
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        font: { size: 10 },
      }}
      config={{ responsive: true, displayModeBar: false }}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}


// ============================================================
// Pillar 3 panel: Electrical insulation leakage
// ============================================================

function Pillar3Panel({ pillar, espData }: { pillar: Pillar3Alarm; espData: EspDataPoint[] }) {
  const borderColor =
    pillar.status === "critical" ? "border-red-300" :
    pillar.status === "warning"  ? "border-orange-300" :
    pillar.status === "normal"   ? "border-green-300" : "border-gray-200";

  return (
    <Card className={`${borderColor} border-2`}>
      <CardHeader className="py-3 px-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-500" />
            <CardTitle className="text-sm">Pillar 3 — Electrical Insulation Leakage</CardTitle>
          </div>
          {!pillar.data_available ? (
            <Badge variant="outline" className="gap-1 border-gray-400 text-gray-500">
              <HelpCircle className="h-3 w-3" />
              No Data
            </Badge>
          ) : (
            <AlarmBadge status={pillar.status} />
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Indicator: current_leak (μA) · 7-day rolling median · 3-day consecutive exceedance condition
        </p>
      </CardHeader>

      <CardContent className="px-4 pb-4">
        {!pillar.data_available ? (
          <div className="text-sm text-muted-foreground py-2">
            No current_leak column data available. This well either has no insulation leakage sensor
            installed or no data was collected.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">Recent Median (μA)</span>
                <span className={`font-mono font-semibold ${
                  pillar.status === "critical" ? "text-red-600" :
                  pillar.status === "warning"  ? "text-orange-600" : "text-foreground"
                }`}>
                  {pillar.current_val != null ? pillar.current_val.toFixed(1) : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">Consecutive Days Exceeded</span>
                <span className={`font-mono font-semibold ${
                  (pillar.days_exceeded ?? 0) >= 3 ? "text-red-600" : "text-foreground"
                }`}>
                  {pillar.days_exceeded != null ? `${pillar.days_exceeded} days` : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">WARNING threshold</span>
                <span className="font-mono text-orange-600">≥ 100μA × 3 days</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">CRITICAL threshold</span>
                <span className="font-mono text-red-600">≥ 1,000μA × 3 days</span>
              </div>
            </div>

            {/* Time-series chart */}
            <div className="h-52 border rounded bg-background/50 mt-3">
              <LeakTrendChart espData={espData} pillar={pillar} />
            </div>

            <div className="mt-3 pt-3 border-t border-dashed text-xs">
              {pillar.status === "critical" && (
                <p className="text-red-700 dark:text-red-400">
                  Leakage current exceeds 1,000μA for 3 consecutive days. Insulation breakdown possible — immediate shutdown and inspection required.
                </p>
              )}
              {pillar.status === "warning" && (
                <p className="text-orange-700 dark:text-orange-400">
                  Leakage current exceeds 100μA for 3 consecutive days. Early signs of insulation degradation — enhanced monitoring required.
                </p>
              )}
              {pillar.status === "normal" && (
                <p className="text-green-700 dark:text-green-400">
                  Leakage current within normal range (below 100μA or no consecutive exceedance).
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}


// ============================================================
// Step 3 result panel
// ============================================================

function Step3ResultPanel({
  result,
  indices,
  espData,
}: {
  result: Step3Response;
  indices: Step1IndexPoint[];
  espData: EspDataPoint[];
}) {
  const statuses = [result.pillar1.status, result.pillar2.status, result.pillar3.status];
  const overallStatus =
    statuses.includes("critical") ? "critical" :
    statuses.includes("warning")  ? "warning"  :
    statuses.every((s) => s === "normal") ? "normal" : "unknown";

  const pillarLabels = ["P1 Hydraulic", "P2 Mechanical", "P3 Electrical"];

  return (
    <div className="space-y-4">
      {/* Overall alarm summary banner */}
      <Card className={
        overallStatus === "critical" ? "border-red-400 bg-red-50/50 dark:bg-red-950/20" :
        overallStatus === "warning"  ? "border-orange-400 bg-orange-50/50 dark:bg-orange-950/20" :
        overallStatus === "normal"   ? "border-green-400 bg-green-50/50 dark:bg-green-950/20" :
        "border-gray-300"
      }>
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-muted-foreground">Overall Alarm Status</span>
              <AlarmBadge status={overallStatus} />
            </div>
            <div className="flex gap-3">
              {[result.pillar1, result.pillar2].map((p, i) => (
                <span key={i} className="text-xs">
                  <span className="text-muted-foreground">{pillarLabels[i]}: </span>
                  <span className={
                    p.status === "critical" ? "text-red-600 font-semibold" :
                    p.status === "warning"  ? "text-orange-600 font-semibold" :
                    p.status === "normal"   ? "text-green-600" : "text-muted-foreground"
                  }>
                    {p.status?.toUpperCase() ?? "UNKNOWN"}
                  </span>
                </span>
              ))}
              <span className="text-xs">
                <span className="text-muted-foreground">{pillarLabels[2]}: </span>
                <span className={
                  result.pillar3.status === "critical" ? "text-red-600 font-semibold" :
                  result.pillar3.status === "warning"  ? "text-orange-600 font-semibold" :
                  result.pillar3.status === "normal"   ? "text-green-600" : "text-muted-foreground"
                }>
                  {!result.pillar3.data_available ? "N/A" :
                    result.pillar3.status?.toUpperCase() ?? "UNKNOWN"}
                </span>
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3 Pillar panels (P1 and P2 include time-series charts) */}
      <Pillar1Panel pillar={result.pillar1} indices={indices} />
      <Pillar2Panel pillar={result.pillar2} indices={indices} />
      <Pillar3Panel pillar={result.pillar3} espData={espData} />

      <div className="flex justify-end">
        <p className="text-xs text-muted-foreground">
          Alarms computed at:{" "}
          {result.computed_at
            ? new Date(result.computed_at).toLocaleString("en-US")
            : "—"}
        </p>
      </div>
    </div>
  );
}


// ============================================================
// Page root
// ============================================================

export default function Step3Page({ params }: Step3PageProps) {
  const { id } = use(params);

  const { data: well } = useWell(id);
  const currentStatus = well?.analysis_status ?? "no_data";

  const stepComplete  = isStepComplete(currentStatus, 3);
  const step1Complete = isStepComplete(currentStatus, 1);

  const { data: result,    isLoading: resultLoading } = useStep3Result(id, stepComplete);
  // Load psi_ma30 and v_std_ma30 time series from Step 1 result (for P1/P2 charts)
  const { data: step1Data, isLoading: step1Loading  } = useStep1Result(id, step1Complete);
  // Load raw sensor data for current_leak (for P3 chart)
  const { data: wellData } = useWellData({ wellId: id });

  const indices = step1Data?.indices ?? [];
  const espData = wellData?.data ?? [];

  // 전체 알람 상태 계산 — CRITICAL 시 ChatbotTrigger에 빨간 배지 표시
  const overallAlarmStatus = result
    ? (
        [result.pillar1.status, result.pillar2.status, result.pillar3.status].includes("critical")
          ? "CRITICAL"
          : [result.pillar1.status, result.pillar2.status, result.pillar3.status].includes("warning")
            ? "WARNING"
            : "NORMAL"
      )
    : null;

  // 분석 결과가 있을 때만 시스템 프롬프트 생성
  const systemPrompt = result
    ? buildStep3SystemPrompt({ wellName: well?.name ?? id, result })
    : "";

  return (
    // step-result-area: html2canvas가 이 영역을 캡처해 vision 챗봇에 전달
    <div id="step-result-area" className="p-4 space-y-4">
      <WorkflowGuard status={currentStatus} requiredStep={3} wellId={id}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">
              Step 3. Fault Mode Monitoring (3-Pillar Alarm)
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Independently evaluates Hydraulic (ψ), Mechanical (v_std), and Electrical (current_leak) fault modes.
              Directly assesses &quot;Is this indicator at risk now?&quot; without predicting a failure date.
            </p>
          </div>
          {/* 우측: 실행 버튼 + AI 질문 버튼 (CRITICAL 알람 배지 포함) */}
          <div className="flex items-center gap-2 shrink-0">
            <AnalysisRunButton wellId={id} step={3} />
            <ChatbotTrigger
              disabled={!result}
              alarmStatus={overallAlarmStatus}
            />
          </div>
        </div>

        {/* 챗봇 패널 (Sheet) */}
        {result && (
          <ChatbotPanel
            stepNumber={3}
            wellId={id}
            systemPrompt={systemPrompt}
            initialMessage="3-Pillar 알람 분석 결과를 요약하고 각 고장 모드별 심각도와 권고 조치를 알려주세요."
          />
        )}

        {/* Loading skeleton */}
        {(resultLoading || step1Loading) && stepComplete && (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-64 w-full rounded-lg" />
            <Skeleton className="h-64 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        )}

        {/* Analysis results */}
        {result && !resultLoading && (
          <Step3ResultPanel
            result={result as Step3Response}
            indices={indices}
            espData={espData}
          />
        )}
      </WorkflowGuard>
    </div>
  );
}
