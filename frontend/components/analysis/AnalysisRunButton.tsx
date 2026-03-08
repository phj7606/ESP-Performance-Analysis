"use client";

/**
 * Analysis Run Button Component
 *
 * Integrates the full flow for running Step 1–3 analyses:
 * 1. Button click → POST request → Celery task_id returned
 * 2. useTaskPolling polls status every 2 seconds
 * 3. On SUCCESS: invalidate cache → well status and results refresh automatically
 * 4. On FAILURE: display error message
 *
 * This single component handles run → polling → success/failure feedback.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Loader2, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunStep } from "@/hooks/useAnalysis";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import { useAnalysisStore } from "@/lib/store";

interface AnalysisRunButtonProps {
  wellId: string;
  /** Step number to run */
  step: 1 | 2 | 3;
  /** Optional callback invoked when analysis completes successfully */
  onSuccess?: () => void;
}

export function AnalysisRunButton({
  wellId,
  step,
  onSuccess,
}: AnalysisRunButtonProps) {
  const queryClient = useQueryClient();
  const { mutate: runStep, isPending: isMutating } = useRunStep(wellId, step);

  // Retrieve the active task_id from the store (null disables polling)
  const taskId = useAnalysisStore((s) => s.getTaskId(wellId, step)) ?? null;
  const clearTaskId = useAnalysisStore((s) => s.clearTaskId);

  // Poll Celery task status
  const { data: task } = useTaskPolling(taskId);

  // On task completion: invalidate cache and invoke callback
  useEffect(() => {
    if (task?.status === "SUCCESS") {
      // Invalidate the well query to refresh analysis_status
      queryClient.invalidateQueries({ queryKey: ["well", wellId] });
      // Invalidate the step result query to re-fetch results
      queryClient.invalidateQueries({ queryKey: ["stepResult", wellId, step] });
      // Also refresh the dashboard well list
      queryClient.invalidateQueries({ queryKey: ["wells"] });
      onSuccess?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.status]);

  // Running: mutation in progress OR Celery task in progress
  const isRunning =
    isMutating ||
    task?.status === "PENDING" ||
    task?.status === "STARTED";

  const isSuccess = task?.status === "SUCCESS";
  const isFailure = task?.status === "FAILURE";

  /** Re-run: clear the existing task_id then start a new run */
  const handleRerun = () => {
    clearTaskId(wellId, step);
    runStep();
  };

  // Success state
  if (isSuccess) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          Analysis Complete
        </div>
        {/* Offer re-run option */}
        <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={handleRerun}>
          <RefreshCw className="h-3 w-3" />
          Re-run
        </Button>
      </div>
    );
  }

  // Failure state
  if (isFailure) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm text-destructive">
          <XCircle className="h-4 w-4" />
          Analysis Failed
        </div>
        <Button variant="outline" size="sm" className="h-7 gap-1" onClick={handleRerun}>
          <RefreshCw className="h-3 w-3" />
          Retry
        </Button>
      </div>
    );
  }

  // Running state
  if (isRunning) {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">
          {task?.status === "PENDING" ? "Queued..." : "Analyzing..."}
        </span>
      </div>
    );
  }

  // Default: run button
  return (
    <Button
      size="sm"
      className="gap-1.5"
      onClick={() => runStep()}
      disabled={isMutating}
    >
      <Play className="h-3.5 w-3.5" />
      Run Step {step} Analysis
    </Button>
  );
}
