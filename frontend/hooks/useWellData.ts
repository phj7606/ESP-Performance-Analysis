"use client";

import { useQuery } from "@tanstack/react-query";
import { getWellData } from "@/lib/api";

interface UseWellDataParams {
  wellId: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * Well 시계열 데이터 조회 훅.
 * 날짜 범위가 변경되어도 이전 데이터를 유지 (placeholderData)하여
 * 로딩 중 차트 깜빡임 방지.
 */
export function useWellData({ wellId, startDate, endDate }: UseWellDataParams) {
  return useQuery({
    queryKey: ["wellData", wellId, startDate, endDate],
    queryFn: () =>
      getWellData(wellId!, {
        start_date: startDate ?? undefined,
        end_date: endDate ?? undefined,
      }),
    enabled: !!wellId,
    staleTime: 30_000,
    // 날짜 범위 변경 시 이전 데이터 유지 (깜빡임 방지)
    placeholderData: (prev) => prev,
  });
}
