"use client";

import { useQuery } from "@tanstack/react-query";
import { getWells } from "@/lib/api";

/** Well 목록 조회 훅 (30초 자동갱신) */
export function useWells() {
  return useQuery({
    queryKey: ["wells"],
    queryFn: getWells,
    // 30초마다 자동 폴링 (건강점수/상태 변경 실시간 반영)
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
