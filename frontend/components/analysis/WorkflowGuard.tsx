"use client";

/**
 * Workflow Guard Component
 *
 * Placed at the top of each Step page to block execution
 * and display a navigation UI when the previous step is not complete.
 *
 * Guard conditions:
 * - Step 1: analysis_status must be 'data_ready' or higher (STATUS_ORDER >= 1)
 * - Step 2: analysis_status must be 'baseline_set' or higher (STATUS_ORDER >= 2)
 * - Step 3: analysis_status must be 'residual_done' or higher (STATUS_ORDER >= 3)
 */

import Link from "next/link";
import { AlertCircle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canRunStep } from "@/lib/workflow";

interface WorkflowGuardProps {
  /** Current analysis status of the well */
  status: string;
  /** Step number this component is guarding */
  requiredStep: 1 | 2 | 3;
  /** ID of the current well (used to build the previous step link) */
  wellId: string;
  children: React.ReactNode;
}

/**
 * Compute the href for the previous step.
 * The previous step for Step 1 is the raw data page (/wells/{id}).
 * For Step 2 and 3, it is step/{N-1}.
 */
function getPrevStepHref(wellId: string, requiredStep: 1 | 2 | 3): string {
  if (requiredStep === 1) {
    // Step 1's prerequisite is data upload, so navigate to the upload page
    return "/upload";
  }
  return `/wells/${wellId}/step/${requiredStep - 1}`;
}

function getPrevStepLabel(requiredStep: 1 | 2 | 3): string {
  if (requiredStep === 1) return "Data Upload";
  return `Step ${requiredStep - 1}`;
}

export function WorkflowGuard({
  status,
  requiredStep,
  wellId,
  children,
}: WorkflowGuardProps) {
  // Check whether the step can be run from the current status
  if (!canRunStep(status, requiredStep)) {
    const prevHref = getPrevStepHref(wellId, requiredStep);
    const prevLabel = getPrevStepLabel(requiredStep);

    return (
      // Blocker UI: lock icon + guidance message + button to navigate to the previous step
      <div className="flex flex-col items-center justify-center min-h-64 gap-4 text-center p-8">
        <div className="p-4 rounded-full bg-muted">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Step {requiredStep} Not Available
          </p>
          <p className="text-xs text-muted-foreground max-w-sm">
            To run this step, you must first complete{" "}
            <span className="font-medium text-foreground">{prevLabel}</span>.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={prevHref}>
            <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
            Go to {prevLabel}
          </Link>
        </Button>
      </div>
    );
  }

  // Render children when execution is allowed
  return <>{children}</>;
}
