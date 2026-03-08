"use client";

import { useQuery } from "@tanstack/react-query";
import { getWell } from "@/lib/api";

/** Hook for fetching single well details */
export function useWell(wellId: string | null) {
  return useQuery({
    queryKey: ["well", wellId],
    queryFn: () => getWell(wellId!),
    enabled: !!wellId,
    staleTime: 30_000,
  });
}
