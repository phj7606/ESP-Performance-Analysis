"use client";

/**
 * Celery async task status polling hook
 *
 * When the FastAPI backend enqueues an analysis task via Celery, it returns a task_id.
 * This hook polls the status every 2 seconds using that task_id, and automatically
 * stops polling once the status reaches SUCCESS or FAILURE.
 */

import { useQuery } from "@tanstack/react-query";
import { getTaskStatus } from "@/lib/api";
import type { TaskStatusResponse } from "@/lib/api";

/**
 * TanStack Query hook that polls a Celery task status.
 *
 * @param taskId - Celery task_id. Query is disabled when null.
 * @returns TanStack Query result (data: TaskStatusResponse | undefined)
 *
 * Behavior:
 * - Query is disabled if taskId is absent (enabled: false)
 * - PENDING/STARTED status: re-fetches every 2 seconds
 * - SUCCESS/FAILURE status: polling stops (refetchInterval: false)
 */
export function useTaskPolling(taskId: string | null) {
  return useQuery<TaskStatusResponse>({
    queryKey: ["task", taskId],
    queryFn: () => getTaskStatus(taskId!),
    enabled: !!taskId,
    // Poll every 2 seconds only when not in a terminal state
    // TanStack Query v5: pass a function to refetchInterval for dynamic control
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll every 2 seconds if status is absent or still in progress
      if (!status || status === "PENDING" || status === "STARTED") {
        return 2000;
      }
      // Stop polling on SUCCESS or FAILURE
      return false;
    },
    // Keep completed task results cached for 10 minutes (no need to re-fetch)
    staleTime: 10 * 60 * 1000,
  });
}
