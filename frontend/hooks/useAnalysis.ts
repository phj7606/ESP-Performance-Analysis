"use client";

/**
 * TanStack Query 훅: Step 1~3 분석 실행 및 결과 조회
 *
 * 분석 실행 흐름:
 * 1. useRunStep(wellId, step).mutate() 호출
 * 2. POST 요청 → Celery task_id 반환 → useAnalysisStore에 저장
 * 3. useTaskPolling(taskId)으로 폴링
 * 4. SUCCESS 시: well 캐시 무효화 → 상태 자동 갱신
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  runStep1, runStep2, runStep2b, runStep3,
  getStep1Result, getStep2Result, getStep2bResult, getStep3Result,
} from "@/lib/api";
import type { Step1Response, Step2Response, Step2bResponse, Step3Response } from "@/lib/api";
import { useAnalysisStore } from "@/lib/store";

// ============================================================
// Step 1~3 실행 훅
// ============================================================

/**
 * Step 1~3 분석 실행 Mutation 훅 (파라미터 없는 기본 버전).
 * 성공 시 task_id를 useAnalysisStore에 저장하여 폴링 시작.
 */
export function useRunStep(wellId: string, step: 1 | 2 | 3) {
  const setTaskId = useAnalysisStore((s) => s.setTaskId);

  const mutationFn = () => {
    if (step === 1) return runStep1(wellId);
    if (step === 2) return runStep2(wellId);
    return runStep3(wellId);
  };

  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      // 반환된 task_id를 스토어에 저장하여 폴링 시작
      setTaskId(wellId, step, data.task_id);
    },
  });
}

/**
 * Step 1 전용 실행 훅 (sg_oil, sg_water 파라미터 지원).
 * mutate() 호출 시 파라미터를 전달.
 */
export function useRunStep1WithParams(wellId: string) {
  const setTaskId = useAnalysisStore((s) => s.setTaskId);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { sg_oil: number; sg_water: number }) =>
      runStep1(wellId, params),
    onSuccess: (data) => {
      setTaskId(wellId, 1, data.task_id);
      // 결과 캐시 무효화 → 분석 완료 후 자동 재조회
      queryClient.invalidateQueries({ queryKey: ["stepResult", wellId, 1] });
    },
  });
}

// ============================================================
// Step 1~3 결과 조회 훅
// ============================================================

/**
 * Step 결과 조회 훅 (제네릭 버전).
 * isStepComplete를 enabled 값으로 전달하여 완료 시에만 조회.
 */
export function useStepResult(
  wellId: string,
  step: 1 | 2 | 3,
  enabled: boolean
) {
  const queryFn = () => {
    if (step === 1) return getStep1Result(wellId);
    if (step === 2) return getStep2Result(wellId);
    return getStep3Result(wellId);
  };

  // Step 2/2b 스왑 후: step===2는 Step2bResponse(Trend-Residual)를 반환
  return useQuery<Step1Response | Step2bResponse | Step3Response>({
    queryKey: ["stepResult", wellId, step],
    queryFn,
    enabled: enabled && !!wellId,
    // 분석 결과는 변경되지 않으므로 5분 캐시
    staleTime: 5 * 60 * 1000,
  });
}

/** Step 1 타입 지정 결과 조회 훅 */
export function useStep1Result(wellId: string, enabled: boolean) {
  return useQuery<Step1Response>({
    queryKey: ["stepResult", wellId, 1],
    queryFn: () => getStep1Result(wellId),
    enabled: enabled && !!wellId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Step 2 타입 지정 결과 조회 훅 (Step 2/2b 스왑 후)
 * GET step2 → Trend-Residual 데이터 → Step2bResponse 반환
 */
export function useStep2Result(wellId: string, enabled: boolean) {
  return useQuery<Step2bResponse>({
    queryKey: ["stepResult", wellId, 2],
    queryFn: () => getStep2Result(wellId),
    enabled: enabled && !!wellId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Step 2-B 타입 지정 결과 조회 훅 (Step 2/2b 스왑 후)
 * GET step2b → GMM 데이터 → Step2Response 반환
 */
export function useStep2bResult(wellId: string, enabled: boolean) {
  return useQuery<Step2Response>({
    queryKey: ["stepResult", wellId, "2b"],
    queryFn: () => getStep2bResult(wellId),
    enabled: enabled && !!wellId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Step 3 타입 지정 결과 조회 훅 */
export function useStep3Result(wellId: string, enabled: boolean) {
  return useQuery<Step3Response>({
    queryKey: ["stepResult", wellId, 3],
    queryFn: () => getStep3Result(wellId),
    enabled: enabled && !!wellId,
    staleTime: 5 * 60 * 1000,
  });
}
