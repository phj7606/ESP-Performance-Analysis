/**
 * 워크플로우 상태 유틸리티
 *
 * ESP 분석 파이프라인 상태 순서 및 Step 실행 가능 여부를 결정하는 순수 유틸리티 함수들.
 * 브라우저 API 의존성 없음 → 클라이언트/서버 모두 사용 가능.
 */

/**
 * 분석 상태 순서 맵.
 * 높은 숫자 = 더 진행된 상태.
 * Step N 완료 조건: STATUS_ORDER[status] > N
 * Step N 실행 조건: STATUS_ORDER[status] >= N
 *
 * 3-Step 파이프라인:
 *   Step 1 (성능 진단): data_ready 이상
 *   Step 2 (건강 점수): diagnosis_done 이상
 *   Step 3 (RUL 예측):  health_done 이상
 */
export const STATUS_ORDER: Record<string, number> = {
  no_data:        0, // 데이터 없음 (업로드 전)
  data_ready:     1, // 데이터 적재 완료 (Step 1 실행 가능)
  diagnosis_done: 2, // 성능 진단 완료 (Step 2 실행 가능)
  health_done:    3, // 건강 점수 완료 (Step 3 실행 가능)
  fully_analyzed: 4, // 전체 분석 완료
};

/**
 * 주어진 분석 상태에서 특정 Step을 실행할 수 있는지 판단.
 * Step 1: data_ready 이상 필요
 * Step 2: diagnosis_done 이상 필요
 * Step 3: health_done 이상 필요
 */
export function canRunStep(status: string, step: number): boolean {
  return (STATUS_ORDER[status] ?? 0) >= step;
}

/**
 * 주어진 상태에서 특정 Step이 이미 완료되었는지 판단.
 * isStepComplete(status, 1): diagnosis_done 이상이면 true
 * isStepComplete(status, 2): health_done 이상이면 true
 * isStepComplete(status, 3): fully_analyzed이면 true
 */
export function isStepComplete(status: string, step: number): boolean {
  return (STATUS_ORDER[status] ?? 0) > step;
}

/** 분석 상태 영문 라벨 */
export const STATUS_LABELS: Record<string, string> = {
  no_data:        "No Data",
  data_ready:     "Data Ready",
  diagnosis_done: "Step 1 Complete",
  health_done:    "Step 2 Complete",
  fully_analyzed: "Fully Analyzed",
};

/** shadcn/ui Badge variant (분석 상태별) */
export type StatusVariant = "default" | "secondary" | "destructive" | "outline";

export function getStatusVariant(status: string): StatusVariant {
  const variantMap: Record<string, StatusVariant> = {
    no_data:        "outline",
    data_ready:     "secondary",
    diagnosis_done: "default",
    health_done:    "default",
    fully_analyzed: "default",
  };
  return variantMap[status] ?? "outline";
}

/** 상태 라벨 반환 (알 수 없는 상태는 그대로 반환) */
export function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
