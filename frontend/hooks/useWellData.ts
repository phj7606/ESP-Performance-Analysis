"use client";

import { useQuery } from "@tanstack/react-query";
import { getWellData } from "@/lib/api";

interface UseWellDataParams {
  wellId: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * Hook for fetching well time-series data.
 * Retains previous data when the date range changes (placeholderData) to
 * prevent chart flickering during loading.
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
    // Retain previous data on date range change (prevents flickering)
    placeholderData: (prev) => prev,
  });
}
