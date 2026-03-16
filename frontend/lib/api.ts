/**
 * API 클라이언트 모듈
 * /api/* 요청은 Next.js rewrites를 통해 백엔드로 프록시됨
 */

export interface WellResponse {
  id: string;
  name: string;
  field: string | null;
  latest_health_score: number | null;
  analysis_status: string;
  data_count: number | null;
  date_range: { start: string; end: string } | null;
  created_at: string;
  updated_at: string;
}

export interface WellListResponse {
  wells: WellResponse[];
  total: number;
}

export interface EspDataPoint {
  date: string;
  choke: number | null;
  whp: number | null;
  flt: number | null;
  casing_pressure: number | null;
  casing_pressure_2: number | null;
  vfd_freq: number | null;
  motor_volts: number | null;
  motor_current: number | null;
  motor_power: number | null;
  motor_temp: number | null;
  motor_vib: number | null;
  current_leak: number | null;
  pi: number | null;
  ti: number | null;
  pd: number | null;
  static_pressure: number | null;
  dd: number | null;
  water_cut: number | null;
  emulsion: number | null;
  bsw: number | null;
  mfm_pressure: number | null;
  mfm_temp: number | null;
  liquid_rate: number | null;
  water_rate: number | null;
  oil_haimo: number | null;
  gas_meter: number | null;
  gor: number | null;
  dp_cross_pump: number | null;
  liquid_pi: number | null;
  oil_pi: number | null;
  comment: string | null;
  esp_type: string | null;
}

export interface EspDataResponse {
  well_id: string;
  data: EspDataPoint[];
  total: number;
  date_range: { start: string; end: string } | null;
}

export interface WellUploadResult {
  well_id: string;
  well_name: string;
  records_inserted: number;
  date_range: { start: string; end: string } | null;
  columns_found: string[];
  warnings: string[];
}

/** 멀티 시트 업로드 결과 */
export interface UploadResponse {
  wells: WellUploadResult[];
  total_wells: number;
  total_records: number;
  message: string;
}

/**
 * 서버 컴포넌트(SSR)는 Next.js rewrite 미들웨어를 거치지 않으므로
 * 백엔드를 직접 호출해야 함. 클라이언트는 /api 상대경로 사용.
 */
const BASE_URL =
  typeof window === "undefined"
    ? `${process.env.BACKEND_INTERNAL_URL ?? "http://backend:8000"}/api`
    : "/api";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

/** 전체 Well 목록 조회 */
export async function getWells(): Promise<WellListResponse> {
  return fetchJson(`${BASE_URL}/wells`);
}

/** 단일 Well 상세 조회 */
export async function getWell(wellId: string): Promise<WellResponse> {
  return fetchJson(`${BASE_URL}/wells/${wellId}`);
}

/** Well 시계열 데이터 조회 */
export async function getWellData(
  wellId: string,
  params?: {
    start_date?: string;
    end_date?: string;
    columns?: string;
  }
): Promise<EspDataResponse> {
  const searchParams = new URLSearchParams();
  if (params?.start_date) searchParams.set("start_date", params.start_date);
  if (params?.end_date) searchParams.set("end_date", params.end_date);
  if (params?.columns) searchParams.set("columns", params.columns);

  const query = searchParams.toString();
  return fetchJson(`${BASE_URL}/wells/${wellId}/data${query ? `?${query}` : ""}`);
}

// ============================================================
// 분석 API 타입 정의
// ============================================================

/** Celery 비동기 태스크 상태 응답 */
export interface TaskStatusResponse {
  task_id: string;
  /** PENDING: 대기, STARTED: 실행 중, SUCCESS: 완료, FAILURE: 실패 */
  status: "PENDING" | "STARTED" | "SUCCESS" | "FAILURE";
  result: unknown | null;
  error: string | null;
}

/** Step 1 무차원 성능 지수 시계열 한 점 */
export interface Step1IndexPoint {
  date: string;
  /** 전력 지수: motor_power / (sg × f³) */
  cp: number | null;
  /** 헤드 지수: (pd-pi) / (sg × f²) */
  psi: number | null;
  /** 진동 지수: motor_vib / f² */
  v_std: number | null;
  /** 냉각 지수: (motor_temp-ti) / motor_power */
  t_eff: number | null;
  /** Efficiency Proxy: (ΔP − C×WHP) × f / motor_power [psi·Hz/kW] — WHP-corrected */
  eta_proxy: number | null;
  /** 펌프 부하 지수: power / (ΔP × liquid_rate) — liquid_rate 측정 시에만 존재 */
  pump_load_index: number | null;
  cp_ma30: number | null;
  psi_ma30: number | null;
  v_std_ma30: number | null;
  t_eff_ma30: number | null;
  eta_proxy_ma30: number | null;
  pump_load_index_ma30: number | null;
  /** Step 2 완료 후 학습 구간 여부 (Step 1 단계에선 모두 false) */
  is_training: boolean;
}

/** Step 1 분석 결과: 4개 무차원 성능 지수 전체 기간 시계열 */
export interface Step1Response {
  well_id: string;
  sg_oil: number;
  sg_water: number;
  data_start: string | null;
  data_end: string | null;
  /** WHP 보정 회귀 기울기 C — ψ_corrected = (ΔP - C×WHP) / (sg×f²) */
  psi_whp_coeff: number | null;
  /** WHP 보정 회귀 절편 */
  psi_whp_intercept: number | null;
  /** WHP 보정 회귀 결정계수 R² */
  psi_whp_r2: number | null;
  /** WHP 회귀에 사용된 유효 데이터 수 */
  psi_whp_n_samples: number | null;
  indices: Step1IndexPoint[];
}

/** Step 2 건강 점수 시계열 한 점 */
export interface Step2HealthPoint {
  date: string;
  mahalanobis_distance: number | null;
  health_score: number | null;           // 0(위험) ~ 100(정상)
  health_status: string | null;          // Normal / Degrading / Critical
  is_training: boolean;                  // CV 학습 구간 여부
  // 피처 기여도: 점수 하락 원인의 비율 (합 = 1.0, 점수 낮을 때 의미 있음)
  contribution_eta:   number | null;     // Efficiency (η_proxy) 기여도 (0~1)
  contribution_v_std: number | null;     // Vibration (v_std) 기여도 (0~1)
  contribution_t_eff: number | null;     // Cooling (t_eff) 기여도 (0~1)
}

/** Step 2 분석 결과: 건강 점수 시계열 + 학습 구간 정보 */
export interface Step2Response {
  well_id: string;
  training_start: string | null;
  training_end: string | null;
  features_used: string[];
  k_factor: number | null;
  scores: Step2HealthPoint[];
}

/** Step 2-B Trend-Residual 편차 점수 시계열 한 점 */
export interface Step2bScorePoint {
  date: string;
  health_score: number | null;     // 하위 호환 유지 (신규 저장 중단)
  health_status: string | null;    // Stable / Elevated / Anomalous
  // 피처별 개별 점수 (하위 호환 유지)
  score_eta:   number | null;
  score_v_std: number | null;
  score_t_eff: number | null;
  // 방향성 Z-score 편차 (MA30 대비, 부호 포함)
  deviation_eta:   number | null;  // η_proxy Z-score (양수=상승, 음수=하락)
  deviation_v_std: number | null;  // v_std Z-score
  deviation_t_eff: number | null;  // t_eff Z-score
  // MA30 기울기 정규화 이탈도 (부호 포함: 양수=상승, 음수=하락)
  slope_norm_eta:   number | null;
  slope_norm_v_std: number | null;
  slope_norm_t_eff: number | null;
}

/** Step 2-B 분석 결과: Trend-Residual 건강 점수 시계열 */
export interface Step2bResponse {
  well_id: string;
  rows_written: number;
  scores: Step2bScorePoint[];
}

/** Pillar 1/2 공통 알람 응답 (Mann-Kendall 추세 기반) */
export interface PillarAlarm {
  /** normal / warning / critical / unknown */
  status: string | null;
  /** Mann-Kendall tau (P1: 음수=하락, P2: 양수=상승) */
  tau: number | null;
  pvalue: number | null;
  /** 최근 지표 값 */
  current_val: number | null;
  /** 베이스라인 평균 */
  baseline_val: number | null;
  /** CRITICAL 임계치 절대값 */
  threshold: number | null;
}

/** Pillar 3 알람 응답 (current_leak 절대값 + 3일 지속 조건) */
export interface Pillar3Alarm {
  /** normal / warning / critical / unknown */
  status: string | null;
  /** 최근 이동 중앙값 (μA) */
  current_val: number | null;
  /** 임계치 초과 연속 일수 */
  days_exceeded: number | null;
  data_available: boolean;
}

/** Pillar 4 알람 응답 (motor_temp 7일 이동 중앙값) */
export interface Pillar4Alarm {
  /** normal / warning / critical / unknown */
  status: string | null;
  /** 7일 이동 중앙값 (°C) */
  current_val: number | null;
  data_available: boolean;
}

/** Step 3 분석 결과: 4-Pillar 독립 고장 모드 알람 */
export interface Step3Response {
  well_id: string;
  computed_at: string | null;
  pillar1: PillarAlarm;   // Hydraulic: ψ 하락 추세
  pillar2: PillarAlarm;   // Mechanical: v_std 상승 추세
  pillar3: Pillar3Alarm;  // Electrical: current_leak 절대값
  pillar4: Pillar4Alarm;  // Thermal: motor_temp 이동 중앙값
}

// ============================================================
// 분석 API 함수
// ============================================================

/** Celery 태스크 상태 조회 */
export async function getTaskStatus(
  taskId: string
): Promise<TaskStatusResponse> {
  return fetchJson(`${BASE_URL}/tasks/${taskId}`);
}

/** Step 1 실행: 성능 진단 (전체 기간 무차원 지수 계산) */
export async function runStep1(
  wellId: string,
  params?: { sg_oil?: number; sg_water?: number }
): Promise<{ task_id: string }> {
  return fetchJson(`${BASE_URL}/wells/${wellId}/analysis/step1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params ?? {}),
  });
}

/** Step 1 결과 조회 */
export async function getStep1Result(wellId: string): Promise<Step1Response> {
  return fetchJson(`${BASE_URL}/wells/${wellId}/analysis/step1`);
}

/** Step 2 실행: 건강 점수 산출 (CV 탐지 + GMM + Mahalanobis) */
export async function runStep2(
  wellId: string,
): Promise<{ task_id: string }> {
  return fetchJson(`${BASE_URL}/wells/${wellId}/analysis/step2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

/**
 * Step 2 결과 조회 — 이제 Trend-Residual 데이터 반환 (Step 2/2b 스왑 후)
 * GET /step2 → trend_residual_scores 테이블 → Step2bResponse 형식
 */
export async function getStep2Result(wellId: string): Promise<Step2bResponse> {
  return fetchJson(`${BASE_URL}/wells/${wellId}/analysis/step2`);
}

/** Step 2-B 실행: GMM Health Scoring (보조 분석으로 전환) */
export async function runStep2b(wellId: string): Promise<{ task_id: string }> {
  return fetchJson(`${BASE_URL}/wells/${wellId}/analysis/step2b`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

/**
 * Step 2-B 결과 조회 — 이제 GMM 데이터 반환 (Step 2/2b 스왑 후)
 * GET /step2b → health_scores 테이블 → Step2Response 형식
 */
export async function getStep2bResult(wellId: string): Promise<Step2Response> {
  return fetchJson(`${BASE_URL}/wells/${wellId}/analysis/step2b`);
}

/** Step 3 실행: 3-Pillar 고장 모드 알람 분석 */
export async function runStep3(
  wellId: string,
): Promise<{ task_id: string }> {
  return fetchJson(`${BASE_URL}/wells/${wellId}/analysis/step3`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

/** Step 3 결과 조회 */
export async function getStep3Result(wellId: string): Promise<Step3Response> {
  return fetchJson(`${BASE_URL}/wells/${wellId}/analysis/step3`);
}

/**
 * Well 통합 데이터 CSV Export
 * esp_daily_data + residual_data(Step1) + health_scores(Step2)를 JOIN한 CSV 파일을 다운로드.
 * 브라우저 환경에서만 동작 (blob → <a> 클릭 방식).
 */
export async function exportCsv(wellId: string): Promise<void> {
  // 서버 컴포넌트에서 호출 시 BASE_URL이 백엔드 내부 URL이므로 클라이언트 전용으로 처리
  const url = `/api/wells/${wellId}/export`;

  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `HTTP ${res.status}`);
  }

  // Content-Disposition 헤더에서 파일명 추출 (없으면 기본값 사용)
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : `well_${wellId}_export.csv`;

  // Blob URL을 생성해 가상 <a> 태그 클릭으로 다운로드 트리거
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // 메모리 해제: 다운로드가 시작된 후 URL 객체 해제
  URL.revokeObjectURL(blobUrl);
}

/** Excel 파일 업로드 */
export async function uploadFile(
  file: File,
  onProgress?: (pct: number) => void
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}/upload`);

    // 업로드 진행률 콜백
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        // 백엔드가 HTML/text를 반환할 때(500, 502 등) JSON.parse 실패 방지
        let errorMessage = `HTTP ${xhr.status}`;
        try {
          const error = JSON.parse(xhr.responseText || "{}");
          errorMessage = error.detail || errorMessage;
        } catch {
          errorMessage = xhr.responseText?.slice(0, 200) || errorMessage;
        }
        reject(new Error(errorMessage));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.send(formData);
  });
}
