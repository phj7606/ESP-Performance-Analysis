"use client";

import { useQuery } from "@tanstack/react-query";
import { getWell } from "@/lib/api";

/** 단일 Well 상세 정보 조회 훅 */
export function useWell(wellId: string | null) {
  return useQuery({
    queryKey: ["well", wellId],
    queryFn: () => getWell(wellId!),
    enabled: !!wellId,
    staleTime: 30_000,
  });
}
