"use client";

import { useQuery } from "@tanstack/react-query";
import { getWells } from "@/lib/api";

/** Hook for fetching the well list (auto-refreshes every 30 seconds) */
export function useWells() {
  return useQuery({
    queryKey: ["wells"],
    queryFn: getWells,
    // Poll every 30 seconds to reflect real-time health score and status changes
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
