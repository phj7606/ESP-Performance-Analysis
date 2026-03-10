"use client";

/**
 * SCR-004: Step 1 — ESP Performance Diagnosis Page
 *
 * Analysis principle:
 * According to Affinity Laws, the following 4 indices should remain constant
 * during normal operation regardless of VFD frequency changes.
 * Therefore, any trend change in the indices is a direct signal of performance degradation.
 *
 *   Cp              = motor_power / (sg × f³)              Power Index
 *   ψ_corrected     = (ΔP − C×WHP) / (sg × f²)            Head Index (WHP-corrected)
 *   V_std           = motor_vib / f²                        Vibration Index
 *   T_eff           = (motor_temp − ti) / motor_power       Cooling Index
 *   η_proxy         = (ΔP − C×WHP) × f / motor_power       Efficiency Proxy [psi·Hz/kW]
 *     where C = WHP regression slope (linear regression of ΔP/(sg·f²) on WHP/(sg·f²))
 *
 * UX flow:
 * 1. Input sg_oil, sg_water parameters
 * 2. Click "Run Step 1 Analysis" → Celery task enqueue → poll task_id
 * 3. On completion, display 4-index subplot chart + Cp vs ψ scatter + η_proxy time series
 */

import { use, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Loader2, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { WorkflowGuard } from "@/components/analysis/WorkflowGuard";
import { useWell } from "@/hooks/useWell";
import { useStep1Result, useRunStep1WithParams } from "@/hooks/useAnalysis";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import { useAnalysisStore } from "@/lib/store";
import { isStepComplete } from "@/lib/workflow";
import type { Step1Response } from "@/lib/api";
// 챗봇 컴포넌트 및 프롬프트 빌더
import { ChatbotTrigger } from "@/components/chatbot/ChatbotTrigger";
import { ChatbotPanel } from "@/components/chatbot/ChatbotPanel";
import { buildStep1SystemPrompt } from "@/lib/chatbot-prompts";

// Plotly SSR 비활성화 (Next.js 서버에서 window 객체 없음)
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface Step1PageProps {
  params: Promise<{ id: string }>;
}


// ============================================================
// 4개 지수 서브플롯 차트
// ============================================================

/**
 * 4개 무차원 성능 지수 시계열 + 30일 MA 서브플롯 (2×2 격자).
 *
 * 색상 규칙:
 *   파란 점  = 학습 구간 (Step 2 완료 후 표시)
 *   회색 점  = 나머지 기간
 *   주황 선  = 30일 이동 평균
 *   파란 배경 = 학습 구간 (Step 2 완료 후)
 */
function IndicesSubplotChart({ result }: { result: Step1Response }) {
  const indices = result.indices;
  const hasTraining = indices.some((r) => r.is_training);

  const dates      = indices.map((r) => r.date);
  const trainDates = indices.filter((r) => r.is_training).map((r) => r.date);
  const otherDates = indices.filter((r) => !r.is_training).map((r) => r.date);

  const indexInfo = [
    { key: "cp",    ma: "cp_ma30",    label: "Cp (Power)",      unit: "kW/Hz³",     row: 1, col: 1 },
    { key: "psi",   ma: "psi_ma30",   label: "ψ (Head)",        unit: "psi/Hz²",    row: 1, col: 2 },
    { key: "v_std", ma: "v_std_ma30", label: "V_std (Vibration)", unit: "g/Hz²×10⁻³", row: 2, col: 1 },
    { key: "t_eff", ma: "t_eff_ma30", label: "T_eff (Cooling)", unit: "℃/kW",       row: 2, col: 2 },
  ] as const;

  const traces: Plotly.Data[] = [];

  for (const info of indexInfo) {
    const axisIdx = (info.row - 1) * 2 + info.col;
    const xAxis   = axisIdx === 1 ? "x"  : `x${axisIdx}`;
    const yAxis   = axisIdx === 1 ? "y"  : `y${axisIdx}`;

    const trainVals = indices.filter((r) => r.is_training).map((r) => r[info.key]);
    const otherVals = indices.filter((r) => !r.is_training).map((r) => r[info.key]);
    const allMa30   = indices.map((r) => r[info.ma]);

    // 학습 구간 산점도 (파란 점) - Step 2 완료 후 표시
    if (hasTraining) {
      traces.push({
        x: trainDates, y: trainVals, type: "scatter", mode: "markers",
        name: `${info.label} (Training)`,
        marker: { color: "rgba(59, 130, 246, 0.5)", size: 3 },
        xaxis: xAxis, yaxis: yAxis, showlegend: false,
      } as Plotly.Data);
    }

    // 나머지 기간 산점도 (회색 점)
    traces.push({
      x: hasTraining ? otherDates : dates,
      y: hasTraining ? otherVals  : indices.map((r) => r[info.key]),
      type: "scatter", mode: "markers",
      name: `${info.label}`,
      marker: { color: "rgba(156, 163, 175, 0.5)", size: 3 },
      xaxis: xAxis, yaxis: yAxis, showlegend: false,
    } as Plotly.Data);

    // 30일 이동 평균 (주황 선)
    traces.push({
      x: dates, y: allMa30, type: "scatter", mode: "lines",
      name: `${info.label} MA30`,
      line: { color: "rgba(234, 179, 8, 0.9)", width: 1.5 },
      connectgaps: true, xaxis: xAxis, yaxis: yAxis, showlegend: false,
    } as Plotly.Data);
  }

  // Step 2 완료 시: 학습 구간 배경 표시
  const trainingStart = hasTraining
    ? indices.find((r) => r.is_training)?.date
    : null;
  const trainingEnd = hasTraining
    ? [...indices].reverse().find((r) => r.is_training)?.date
    : null;

  const xAxisNames = ["x", "x2", "x3", "x4"] as const;
  const trainingShapes = hasTraining
    ? indexInfo.map((info, idx) => ({
        type: "rect" as const,
        xref: xAxisNames[idx] as "x" | "x2" | "x3" | "x4",
        yref: "paper" as const,
        x0: trainingStart,
        x1: trainingEnd,
        y0: info.row === 1 ? 0.55 : 0.0,
        y1: info.row === 1 ? 1.0  : 0.45,
        fillcolor: "rgba(59, 130, 246, 0.07)",
        line: { width: 0 },
        layer: "below" as const,
      }))
    : [];

  // ψ 서브플롯(row=1, col=2)에 WHP 보정 계수 주석 추가
  const psiWhpCoeff     = result.psi_whp_coeff;
  const psiWhpIntercept = result.psi_whp_intercept;
  const psiWhpR2        = result.psi_whp_r2;
  const hasPsiWhp       = psiWhpCoeff !== null && psiWhpCoeff !== undefined;

  // 서브플롯 레이블 어노테이션 + ψ WHP 보정 주석
  const annotations: Partial<Plotly.Annotations>[] = [
    ...indexInfo.map((info) => ({
      text: `<b>${info.label}</b>`,
      x: 0.5, y: info.row === 1 ? 1.0 : 0.45,
      xref: "paper" as const, yref: "paper" as const,
      xanchor: "center" as const, yanchor: "bottom" as const,
      showarrow: false, font: { size: 11 },
      xshift: info.col === 1 ? -170 : 170,
    })),
    // ψ 서브플롯(x2축) 우상단에 WHP 보정 정보 주석 표시
    ...(hasPsiWhp ? [{
      text: `WHP corr: C=${psiWhpCoeff!.toFixed(4)}, R²=${(psiWhpR2 ?? 0).toFixed(3)}`,
      x: 1.0, xref: "paper" as const,
      y: 1.0, yref: "paper" as const,
      xanchor: "right" as const, yanchor: "top" as const,
      showarrow: false,
      font: { size: 8, color: "rgba(100, 116, 139, 0.9)" },
      bgcolor: "rgba(255, 255, 255, 0.7)",
    }] : []),
  ];

  const layout: Partial<Plotly.Layout> = {
    grid: { rows: 2, columns: 2, pattern: "independent" as const },
    shapes: trainingShapes,
    annotations,
    margin: { t: 40, r: 20, b: 40, l: 60 },
    autosize: true,
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    font: { size: 10 },
  };

  return (
    <Plot
      data={traces}
      layout={layout}
      config={{ responsive: true, displayModeBar: false }}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}


// ============================================================
// Cp vs ψ scatter plot
// ============================================================

/**
 * Power Index(Cp) vs Head Index(ψ) scatter plot.
 *
 * 시간 순서에 따른 그라디언트 색상으로 성능 저하 방향을 시각화.
 * Step 2 완료 후에는 학습 구간(파란 점) vs 나머지(회색 점)로 구분.
 *
 * Color logic:
 *   - No training data: viridis colorscale by time index (early=blue, recent=yellow)
 *   - With training data: blue markers for training, gray for the rest
 */
function PowerHeadScatterChart({ result }: { result: Step1Response }) {
  const indices     = result.indices;
  const hasTraining = indices.some((r) => r.is_training);

  const traces: Plotly.Data[] = [];

  if (hasTraining) {
    // Step 2 완료: 학습 구간(파란 점) vs 나머지(회색 점) 구분
    const trainPts = indices.filter((r) => r.is_training);
    const otherPts = indices.filter((r) => !r.is_training);

    traces.push({
      x: trainPts.map((r) => r.cp),
      y: trainPts.map((r) => r.psi),
      type: "scatter",
      mode: "markers",
      name: "Training period",
      text: trainPts.map((r) => r.date),
      hovertemplate: "%{text}<br>Cp: %{x:.4f}<br>ψ: %{y:.4f}<extra></extra>",
      marker: { color: "rgba(59, 130, 246, 0.6)", size: 4 },
    } as Plotly.Data);

    traces.push({
      x: otherPts.map((r) => r.cp),
      y: otherPts.map((r) => r.psi),
      type: "scatter",
      mode: "markers",
      name: "Other",
      text: otherPts.map((r) => r.date),
      hovertemplate: "%{text}<br>Cp: %{x:.4f}<br>ψ: %{y:.4f}<extra></extra>",
      marker: { color: "rgba(156, 163, 175, 0.5)", size: 4 },
    } as Plotly.Data);
  } else {
    // Step 2 미완료: 시간 순서 기반 viridis 그라디언트 색상
    traces.push({
      x: indices.map((r) => r.cp),
      y: indices.map((r) => r.psi),
      type: "scatter",
      mode: "markers",
      name: "Cp vs ψ",
      text: indices.map((r) => r.date),
      hovertemplate: "%{text}<br>Cp: %{x:.4f}<br>ψ: %{y:.4f}<extra></extra>",
      marker: {
        // 시간 인덱스 0→N 으로 그라디언트 — 초기=보라, 최근=노랑
        color: indices.map((_, i) => i),
        colorscale: "Viridis",
        size: 4,
        showscale: true,
        colorbar: { title: { text: "Time →" }, thickness: 12, len: 0.8 },
      },
    } as Plotly.Data);
  }

  return (
    <Plot
      data={traces}
      layout={{
        xaxis: { title: { text: "Cp (Power Index)" } },
        yaxis: { title: { text: "ψ (Head Index)" } },
        legend: { orientation: "h", y: -0.25 },
        margin: { t: 10, r: 20, b: 50, l: 70 },
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
// η_proxy 시계열 차트 (단독)
// ============================================================

/**
 * η_proxy = (ΔP − C×WHP) × f / motor_power  [psi·Hz/kW]
 *
 * Derived from ψ_corrected / Cp — sg cancels out by affinity laws,
 * so no fluid density correction is needed.
 * The f term indirectly reflects flow rate (Q ∝ f), making this more
 * physically meaningful than a simple ΔP/P ratio.
 */
function EfficiencyProxyChart({ result }: { result: Step1Response }) {
  const indices = result.indices;
  const hasTraining = indices.some((r) => r.is_training);
  const dates = indices.map((r) => r.date);

  const trainingStart = hasTraining
    ? indices.find((r) => r.is_training)?.date
    : null;
  const trainingEnd = hasTraining
    ? [...indices].reverse().find((r) => r.is_training)?.date
    : null;

  // WHP 회귀 결과 annotation — 우상단에 보정 계수 표시
  const whpAnnotations: Partial<Plotly.Annotations>[] =
    result.psi_whp_coeff != null
      ? [{
          text: `WHP corr: C=${result.psi_whp_coeff.toFixed(4)}, R²=${(result.psi_whp_r2 ?? 0).toFixed(3)}, n=${result.psi_whp_n_samples}`,
          x: 1.0, xref: "paper" as const,
          y: 1.0, yref: "paper" as const,
          xanchor: "right" as const, yanchor: "top" as const,
          showarrow: false,
          font: { size: 8, color: "rgba(100, 116, 139, 0.9)" },
          bgcolor: "rgba(255, 255, 255, 0.7)",
        }]
      : [];

  return (
    <Plot
      data={[
        // Raw scatter (gray dots)
        {
          x: dates, y: indices.map((r) => r.eta_proxy),
          type: "scatter", mode: "markers",
          name: "η_proxy",
          marker: { color: "rgba(156, 163, 175, 0.4)", size: 3 },
        },
        // 30-day moving average (orange line)
        {
          x: dates, y: indices.map((r) => r.eta_proxy_ma30),
          type: "scatter", mode: "lines",
          name: "MA30",
          line: { color: "rgba(234, 179, 8, 0.9)", width: 1.5 },
          connectgaps: true,
        },
      ]}
      layout={{
        shapes: hasTraining ? [{
          type: "rect", xref: "x", yref: "paper",
          x0: trainingStart, x1: trainingEnd,
          y0: 0, y1: 1,
          fillcolor: "rgba(59, 130, 246, 0.07)",
          line: { width: 0 }, layer: "below",
        }] : [],
        annotations: whpAnnotations,
        xaxis: { title: { text: "Date" } },
        yaxis: { title: { text: "η_proxy (psi·Hz/kW)" } },
        legend: { orientation: "h", y: -0.28 },
        margin: { t: 30, r: 20, b: 60, l: 80 },
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
// Pump Load Index 시계열 차트 (단독)
// ============================================================

/**
 * Pump Load Index = motor_power / (ΔP × liquid_rate)
 *
 * 단위 수력 일(ΔP × Q) 당 소비 전력 → 클수록 전력 대비 펌핑 효율 저하.
 * liquid_rate는 현장 테스트 시에만 측정되므로 점이 드문드문 표시됨.
 */
function PumpLoadIndexChart({ result }: { result: Step1Response }) {
  const indices = result.indices;
  const hasTraining = indices.some((r) => r.is_training);
  const dates = indices.map((r) => r.date);

  // liquid_rate가 없는 날이 많으므로 값이 있는 날만 필터링해서 점 표시
  const trainingStart = hasTraining
    ? indices.find((r) => r.is_training)?.date
    : null;
  const trainingEnd = hasTraining
    ? [...indices].reverse().find((r) => r.is_training)?.date
    : null;

  return (
    <Plot
      data={[
        // 원시 산점도 (초록 점) — liquid_rate 없는 날 null → 자동으로 점 없음
        {
          x: dates, y: indices.map((r) => r.pump_load_index),
          type: "scatter", mode: "markers",
          name: "Pump Load Index",
          marker: { color: "rgba(34, 197, 94, 0.5)", size: 4 },
          connectgaps: false,
        },
        // 30일 MA (초록 선) — null 구간에서 끊김
        {
          x: dates, y: indices.map((r) => r.pump_load_index_ma30),
          type: "scatter", mode: "lines",
          name: "MA30",
          line: { color: "rgba(34, 197, 94, 0.9)", width: 1.5 },
          connectgaps: false,
        },
      ]}
      layout={{
        shapes: hasTraining ? [{
          type: "rect", xref: "x", yref: "paper",
          x0: trainingStart, x1: trainingEnd,
          y0: 0, y1: 1,
          fillcolor: "rgba(59, 130, 246, 0.07)",
          line: { width: 0 }, layer: "below",
        }] : [],
        xaxis: { title: { text: "Date" } },
        yaxis: { title: { text: "Pump Load Index (kW / psi·m³/d)" } },
        legend: { orientation: "h", y: -0.28 },
        margin: { t: 10, r: 20, b: 60, l: 80 },
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
// Step 1 실행 버튼 (sg 파라미터 포함)
// ============================================================

function Step1RunButton({
  wellId,
  sgOil,
  sgWater,
}: {
  wellId: string;
  sgOil: number;
  sgWater: number;
}) {
  const queryClient = useQueryClient();
  const { mutate: runStep1, isPending: isMutating } = useRunStep1WithParams(wellId);
  const taskId      = useAnalysisStore((s) => s.getTaskId(wellId, 1)) ?? null;
  const clearTaskId = useAnalysisStore((s) => s.clearTaskId);
  const { data: task } = useTaskPolling(taskId);

  useEffect(() => {
    if (task?.status === "SUCCESS") {
      queryClient.invalidateQueries({ queryKey: ["well", wellId] });
      queryClient.invalidateQueries({ queryKey: ["stepResult", wellId, 1] });
      queryClient.invalidateQueries({ queryKey: ["wells"] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.status]);

  const isRunning = isMutating || task?.status === "PENDING" || task?.status === "STARTED";
  const isSuccess = task?.status === "SUCCESS";
  const isFailure = task?.status === "FAILURE";

  const handleRun   = () => runStep1({ sg_oil: sgOil, sg_water: sgWater });
  const handleRerun = () => {
    clearTaskId(wellId, 1);
    runStep1({ sg_oil: sgOil, sg_water: sgWater });
  };

  if (isSuccess) return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-sm text-green-600">
        <CheckCircle2 className="h-4 w-4" /> Analysis Complete
      </div>
      <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={handleRerun}>
        <RefreshCw className="h-3 w-3" /> Re-run
      </Button>
    </div>
  );

  if (isFailure) return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-sm text-destructive">
        <XCircle className="h-4 w-4" /> Failed: {task?.error ?? "Unknown"}
      </div>
      <Button variant="outline" size="sm" className="h-7 gap-1" onClick={handleRerun}>
        <RefreshCw className="h-3 w-3" /> Retry
      </Button>
    </div>
  );

  if (isRunning) return (
    <div className="flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <span className="text-sm text-muted-foreground">
        {task?.status === "PENDING" ? "Queued..." : "Analyzing..."}
      </span>
    </div>
  );

  return (
    <Button size="sm" className="gap-1.5" onClick={handleRun} disabled={isMutating}>
      <Play className="h-3.5 w-3.5" /> Run Step 1 Analysis
    </Button>
  );
}


// ============================================================
// 페이지 루트
// ============================================================

export default function Step1Page({ params }: Step1PageProps) {
  const { id } = use(params);

  // 유체 비중 파라미터 상태
  const [sgOil,   setSgOil]   = useState(0.85);
  const [sgWater, setSgWater] = useState(1.03);

  const { data: well } = useWell(id);
  const currentStatus  = well?.analysis_status ?? "no_data";

  // Step 1 완료 시에만 결과 조회
  const stepComplete = isStepComplete(currentStatus, 1);
  const { data: result, isLoading: resultLoading } = useStep1Result(id, stepComplete);

  // 분석 결과가 있을 때만 시스템 프롬프트 생성 (result가 없으면 빈 문자열)
  const systemPrompt = result
    ? buildStep1SystemPrompt({ wellName: well?.name ?? id, result })
    : "";

  return (
    // step-result-area: html2canvas가 이 영역을 캡처해 vision 챗봇에 전달
    <div id="step-result-area" className="p-4 space-y-4">
      {/* 워크플로우 가드: data_ready 이상이어야 Step 1 실행 가능 */}
      <WorkflowGuard status={currentStatus} requiredStep={1} wellId={id}>

        {/* 헤더: 제목 + 실행 버튼 + AI 질문 버튼 */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">
              Step 1. ESP Performance Diagnosis
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              According to Affinity Laws, Cp, ψ, V_std, T_eff should remain constant
              regardless of VFD frequency changes. ψ is WHP-corrected via linear regression
              (ψ_corr = (ΔP − C×WHP) / (sg×f²)) to isolate pump degradation from surface pressure changes.
            </p>
          </div>
          {/* 우측: 실행 버튼 + AI 질문 버튼 */}
          <div className="flex items-center gap-2 shrink-0">
            <Step1RunButton wellId={id} sgOil={sgOil} sgWater={sgWater} />
            {/* 분석 결과 없을 때 비활성화 */}
            <ChatbotTrigger disabled={!result} />
          </div>
        </div>

        {/* 챗봇 패널 (Sheet) — 항상 DOM에 존재하며 isPanelOpen으로 표시/숨김 */}
        {result && (
          <ChatbotPanel
            stepNumber={1}
            wellId={id}
            systemPrompt={systemPrompt}
            initialMessage="Step 1 분석 결과를 요약하고 주목할 지수 변화가 있으면 알려주세요."
          />
        )}

        {/* 유체 비중 파라미터 입력 */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Input Parameters</CardTitle>
            <p className="text-xs text-muted-foreground">
              SG_liquid = BSW × SG_water + (1 − BSW) × SG_oil.
              Corrects for fluid density when computing dimensionless indices.
            </p>
          </CardHeader>
          <CardContent className="py-3 px-4">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="text-xs font-medium">Oil Specific Gravity (SG_oil)</label>
                <Input
                  type="number"
                  value={sgOil}
                  onChange={(e) => setSgOil(parseFloat(e.target.value) || 0.85)}
                  step="0.01" min="0.7" max="1.0" className="h-8 text-sm"
                />
                <p className="text-xs text-muted-foreground">Typical crude oil: 0.80 – 0.90</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Water Specific Gravity (SG_water)</label>
                <Input
                  type="number"
                  value={sgWater}
                  onChange={(e) => setSgWater(parseFloat(e.target.value) || 1.03)}
                  step="0.01" min="1.0" max="1.1" className="h-8 text-sm"
                />
                <p className="text-xs text-muted-foreground">Seawater: ~1.025</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 로딩 스켈레톤 */}
        {resultLoading && stepComplete && (
          <div className="space-y-4">
            <Skeleton className="h-80 w-full rounded-lg" />
            <Skeleton className="h-56 w-full rounded-lg" />
          </div>
        )}

        {/* 분석 결과: 4개 지수 서브플롯 */}
        {result && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">
                  Dimensionless Performance Indices — Full Period
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Under normal operation, all 4 indices should remain constant regardless of frequency.{" "}
                  <span className="text-yellow-600 font-medium">Orange line</span> = 30-day moving average.
                  {result.indices.some((r) => r.is_training) && (
                    <> <span className="text-blue-500 font-medium">Blue background</span> = Step 2 training period.</>
                  )}
                </p>
                {/* WHP correction regression results — coefficient displayed on ψ subplot annotation */}
                {result.psi_whp_r2 !== null && result.psi_whp_r2 !== undefined && (
                  <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                    ψ WHP correction — C: {result.psi_whp_coeff?.toFixed(4)},
                    intercept: {result.psi_whp_intercept?.toFixed(4)},
                    R²: {result.psi_whp_r2?.toFixed(3)},
                    n={result.psi_whp_n_samples}
                  </p>
                )}
              </CardHeader>
              <CardContent className="h-80 px-2 pb-2">
                <IndicesSubplotChart result={result as Step1Response} />
              </CardContent>
            </Card>

            {/* Cp vs ψ Scatter: 성능 저하 방향을 2D 위상 공간에서 시각화 */}
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Cp vs ψ — Power-Head Phase Space</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Scatter of Power Index (Cp) vs Head Index (ψ).
                  Color encodes time progression (early → recent).
                  {result.indices.some((r) => r.is_training) && (
                    <> <span className="text-blue-500 font-medium">Blue</span> = training period.</>
                  )}
                </p>
              </CardHeader>
              <CardContent className="h-64 px-2 pb-2">
                <PowerHeadScatterChart result={result as Step1Response} />
              </CardContent>
            </Card>

            {/* η_proxy = ψ/Cp: 수력 성능 대비 전력 효율 비율 */}
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">η_proxy — Efficiency Proxy (WHP-corrected)</CardTitle>
                <p className="text-xs text-muted-foreground">
                  η_proxy = (ΔP − C×WHP) × f / motor_power (psi·Hz/kW).
                  SG cancels by affinity laws — no fluid density correction needed.
                  A declining trend indicates hydraulic efficiency degradation.
                </p>
              </CardHeader>
              <CardContent className="h-56 px-2 pb-2">
                <EfficiencyProxyChart result={result as Step1Response} />
              </CardContent>
            </Card>

            {/* Pump Load Index: 유량 대비 전력 부하 (현장 테스트일만 표시) */}
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Pump Load Index — Power per Unit Hydraulic Work</CardTitle>
                <p className="text-xs text-muted-foreground">
                  PLI = motor_power / (ΔP × liquid_rate).
                  Power consumed per unit hydraulic work — higher means lower pumping efficiency.{" "}
                  <span className="text-muted-foreground/70">Points shown only on days when liquid_rate is measured.</span>
                </p>
              </CardHeader>
              <CardContent className="h-56 px-2 pb-2">
                <PumpLoadIndexChart result={result as Step1Response} />
              </CardContent>
            </Card>

            {/* 데이터 범위 요약 */}
            {(result as Step1Response).data_start && (
              <div className="text-xs text-muted-foreground text-right">
                Analysis period: {(result as Step1Response).data_start} ~{" "}
                {(result as Step1Response).data_end} ({(result as Step1Response).indices.length} days)
              </div>
            )}
          </div>
        )}
      </WorkflowGuard>
    </div>
  );
}
