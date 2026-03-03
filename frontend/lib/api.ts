/**
 * API 클라이언트 모듈
 * Next.js rewrites를 통해 /api/* → 백엔드로 프록시됨
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

export interface UploadResponse {
  well_id: string;
  well_name: string;
  records_inserted: number;
  date_range: { start: string; end: string } | null;
  columns_found: string[];
  warnings: string[];
  message: string;
}

const BASE_URL = "/api";

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

/** Well 상세 정보 조회 */
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
        // 백엔드가 HTML/텍스트를 반환하는 경우 (500, 502 등) JSON.parse 실패 방지
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

    xhr.addEventListener("error", () => reject(new Error("네트워크 오류")));
    xhr.send(formData);
  });
}
