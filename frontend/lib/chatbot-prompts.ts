/**
 * 챗봇 시스템 프롬프트 빌더
 *
 * 각 Step의 분석 결과 데이터를 LLM이 이해할 수 있는 컨텍스트 문자열로 변환.
 * 프롬프트 내용을 코드와 분리해 유지보수성을 확보.
 *
 * Step 1: 무차원 성능 지수 추세 (MA30 기준 첫값→끝값 변화율)
 * Step 2: 건강 점수 현황 + 상태별 일수 + 주요 지표 추세
 * Step 3: 3-Pillar 고장 모드 진단 상세
 */

import type { Step1Response, Step2bResponse, Step3Response } from "@/lib/api";

// ============================================================
// Step 1 프롬프트 빌더
// ============================================================

/** Step 1 프롬프트 생성에 필요한 컨텍스트 타입 */
export interface Step1PromptContext {
  wellName: string;
  result: Step1Response;
}

/**
 * MA30 배열에서 NaN/null 제거 후 첫 유효값과 마지막 유효값 추출.
 * 변화율(%) = (last - first) / |first| × 100
 */
function calcMaTrend(values: (number | null | undefined)[]): {
  first: number | null;
  last: number | null;
  changePct: number | null;
} {
  // null/undefined 필터링
  const valid = values.filter((v): v is number => v != null && !isNaN(v));
  if (valid.length < 2) return { first: null, last: null, changePct: null };

  const first = valid[0];
  const last  = valid[valid.length - 1];
  const changePct = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null;

  return { first, last, changePct };
}

export function buildStep1SystemPrompt({ wellName, result }: Step1PromptContext): string {
  const indices = result.indices;
  const n       = indices.length;
  const start   = indices[0]?.date ?? "N/A";
  const end     = indices[n - 1]?.date ?? "N/A";

  // 각 지수의 MA30 추세 계산
  const cp    = calcMaTrend(indices.map((r) => r.cp_ma30));
  const psi   = calcMaTrend(indices.map((r) => r.psi_ma30));
  const vStd  = calcMaTrend(indices.map((r) => r.v_std_ma30));
  const tEff  = calcMaTrend(indices.map((r) => r.t_eff_ma30));
  const eta   = calcMaTrend(indices.map((r) => r.eta_proxy_ma30));

  // WHP 보정 계수 (null이면 미적용)
  const coeff    = result.psi_whp_coeff;
  const r2       = result.psi_whp_r2;
  const nSamples = result.psi_whp_n_samples;
  const whpLine  = coeff != null
    ? `WHP 보정: C=${coeff.toFixed(4)}, R²=${(r2 ?? 0).toFixed(3)} (n=${nSamples})`
    : "WHP 보정: 미적용";

  const fmt  = (v: number | null) => v != null ? v.toFixed(4) : "N/A";
  const fmtp = (v: number | null) => v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : "N/A";

  return `당신은 ESP(Electric Submersible Pump) 무차원 성능 분석 전문가입니다.
Well: ${wellName} | 분석 기간: ${start} ~ ${end} (${n}일)
${whpLine}

=== 무차원 성능 지수 추세 (MA30 기준) ===
- Cp  (전력 지수):    ${fmt(cp.first)} → ${fmt(cp.last)}  (${fmtp(cp.changePct)})
- ψ   (헤드 지수):   ${fmt(psi.first)} → ${fmt(psi.last)}  (${fmtp(psi.changePct)})
- V_std (진동 지수): ${fmt(vStd.first)} → ${fmt(vStd.last)}  (${fmtp(vStd.changePct)})
- T_eff (냉각 지수): ${fmt(tEff.first)} → ${fmt(tEff.last)}  (${fmtp(tEff.changePct)})
- η_proxy (효율):    ${fmt(eta.first)} → ${fmt(eta.last)}  (${fmtp(eta.changePct)})

각 지수 의미:
- Cp: 전력 지수 (전기·기계 효율 — 상승 시 동일 속도 대비 전력 소비 증가)
- ψ: 펌프 양정 지수 (수력 성능 — 하락 시 임펠러 마모 또는 스케일링 의심)
- V_std: 진동 분산 지수 (베어링/로터 이상 — 상승 시 기계적 마모)
- T_eff: 냉각 효율 지수 (모터 냉각 능력 — 상승 시 유체 냉각 부족)
- η_proxy: WHP 보정 효율 (수력 효율 종합 — 하락 시 성능 저하)

한국어로 간결하고 전문적으로 답변하세요.`;
}

// ============================================================
// Step 2 프롬프트 빌더
// ============================================================

export interface Step2PromptContext {
  wellName: string;
  result: Step2bResponse;
}

export function buildStep2SystemPrompt({ wellName, result }: Step2PromptContext): string {
  const scores = result.scores;
  const n      = scores.length;
  const start  = scores[0]?.date ?? "N/A";
  const end    = scores[n - 1]?.date ?? "N/A";

  // 최신 건강 점수 (null 제외 역순 탐색)
  const latest = [...scores].reverse().find((s) => s.health_score != null);
  const latestScore  = latest?.health_score?.toFixed(1) ?? "N/A";
  const latestStatus = latest?.health_status ?? "Unknown";

  // 상태별 일수 집계
  const normalDays    = scores.filter((s) => (s.health_score ?? 100) >= 70).length;
  const degradingDays = scores.filter((s) => {
    const h = s.health_score ?? 100;
    return h >= 40 && h < 70;
  }).length;
  const criticalDays = scores.filter((s) => (s.health_score ?? 100) < 40).length;

  // 각 지표의 첫값→끝값 추세 (null 안전 처리)
  const etaFirst = scores.find((s) => s.score_eta != null)?.score_eta?.toFixed(1) ?? "N/A";
  const etaLast  = [...scores].reverse().find((s) => s.score_eta != null)?.score_eta?.toFixed(1) ?? "N/A";

  const vFirst = scores.find((s) => s.score_v_std != null)?.score_v_std?.toFixed(1) ?? "N/A";
  const vLast  = [...scores].reverse().find((s) => s.score_v_std != null)?.score_v_std?.toFixed(1) ?? "N/A";

  const tFirst = scores.find((s) => s.score_t_eff != null)?.score_t_eff?.toFixed(1) ?? "N/A";
  const tLast  = [...scores].reverse().find((s) => s.score_t_eff != null)?.score_t_eff?.toFixed(1) ?? "N/A";

  return `당신은 ESP(Electric Submersible Pump) 성능 분석 전문가입니다.
Well: ${wellName} | 분석 기간: ${start} ~ ${end} (${n}일)

=== 건강 점수 현황 (Trend-Residual 기반) ===
- 최신 점수: ${latestScore}/100 (${latestStatus})
- 정상(≥70): ${normalDays}일 / 저하(40~70): ${degradingDays}일 / 위험(<40): ${criticalDays}일

=== 알고리즘 구조 ===
- EWMA(span=7) 평활화 → MA30 베이스라인 편차 페널티(≤40pt) + 기울기 페널티(≤60pt)
- 가중치: 효율(η) 50%, 진동(v_std) 30%, 냉각(t_eff) 20%
- 점수 하한: 10pt (Prophet 외삽 발산 방지)

=== 지표별 추세 (첫날 → 최신) ===
- 효율(η_proxy): ${etaFirst}pt → ${etaLast}pt
- 진동(v_std): ${vFirst}pt → ${vLast}pt
- 냉각(t_eff): ${tFirst}pt → ${tLast}pt

임계치: 70pt = 저하 경계 (Degrading), 40pt = 위험 경계 (Critical, RUL 트리거)

한국어로 간결하고 전문적으로 답변하세요.`;
}

// ============================================================
// Step 3 프롬프트 빌더
// ============================================================

export interface Step3PromptContext {
  wellName: string;
  result: Step3Response;
}

export function buildStep3SystemPrompt({ wellName, result }: Step3PromptContext): string {
  const { pillar1, pillar2, pillar3, computed_at } = result;

  // 전체 상태 계산 (CRITICAL > WARNING > NORMAL 우선순위)
  const statuses = [pillar1.status, pillar2.status, pillar3.status];
  const overallStatus =
    statuses.includes("critical") ? "CRITICAL" :
    statuses.includes("warning")  ? "WARNING"  :
    statuses.every((s) => s === "normal") ? "NORMAL" : "UNKNOWN";

  // 계산 시각 포맷
  const computedAt = computed_at
    ? new Date(computed_at).toLocaleString("ko-KR")
    : "N/A";

  // ψ 베이스라인 대비 변화율 계산
  const psi1ChangePct =
    pillar1.baseline_val && pillar1.current_val
      ? (((pillar1.current_val - pillar1.baseline_val) / Math.abs(pillar1.baseline_val)) * 100).toFixed(1)
      : "N/A";

  // v_std 베이스라인 대비 변화율 계산
  const psi2ChangePct =
    pillar2.baseline_val && pillar2.current_val
      ? (((pillar2.current_val - pillar2.baseline_val) / Math.abs(pillar2.baseline_val)) * 100).toFixed(1)
      : "N/A";

  return `당신은 ESP 고장 모드 진단 전문가입니다.
Well: ${wellName} | 계산 시각: ${computedAt} | 전체 상태: ${overallStatus}

=== Pillar 1 (수리학적 저하 — ψ_ma30 하락) ===
상태: ${(pillar1.status ?? "unknown").toUpperCase()}
Mann-Kendall τ=${pillar1.tau?.toFixed(3) ?? "N/A"}, p=${pillar1.pvalue?.toFixed(3) ?? "N/A"}
현재 ψ: ${pillar1.current_val?.toFixed(4) ?? "N/A"} (베이스라인: ${pillar1.baseline_val?.toFixed(4) ?? "N/A"}, 임계치: ${pillar1.threshold?.toFixed(4) ?? "N/A"})
베이스라인 대비 변화: ${psi1ChangePct !== "N/A" ? `${Number(psi1ChangePct) >= 0 ? "+" : ""}${psi1ChangePct}%` : "N/A"}
판정 기준: MK 하락 추세(τ<0, p<0.05) + ψ > baseline×0.8(−20%) 시 CRITICAL

=== Pillar 2 (기계적 마모 — v_std_ma30 상승) ===
상태: ${(pillar2.status ?? "unknown").toUpperCase()}
Mann-Kendall τ=${pillar2.tau?.toFixed(3) ?? "N/A"}, p=${pillar2.pvalue?.toFixed(3) ?? "N/A"}
현재 v_std: ${pillar2.current_val?.toFixed(4) ?? "N/A"} (베이스라인: ${pillar2.baseline_val?.toFixed(4) ?? "N/A"}, 임계치: ${pillar2.threshold?.toFixed(4) ?? "N/A"})
베이스라인 대비 변화: ${psi2ChangePct !== "N/A" ? `${Number(psi2ChangePct) >= 0 ? "+" : ""}${psi2ChangePct}%` : "N/A"}
판정 기준: MK 상승 추세(τ>0, p<0.05) + v_std > baseline×1.5(+50%) 시 CRITICAL

=== Pillar 3 (전기적 절연 누설 — current_leak) ===
데이터 유무: ${pillar3.data_available ? "있음" : "없음 (센서 미설치 또는 데이터 미수집)"}
${pillar3.data_available ? `
상태: ${(pillar3.status ?? "unknown").toUpperCase()}
누설전류 최근 중앙값: ${pillar3.current_val?.toFixed(1) ?? "N/A"} μA
연속 초과일: ${pillar3.days_exceeded ?? "N/A"}일
판정 기준: 7일 롤링 중앙값 ≥100μA × 3일 연속=WARNING, ≥1000μA × 3일 연속=CRITICAL` : ""}

한국어로 간결하고 전문적으로 답변하세요.`;
}
