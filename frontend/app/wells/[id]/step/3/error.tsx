"use client";

/**
 * Step 3 error UI
 * error.tsx requires the 'use client' directive.
 */

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Step3Error({ error, reset }: ErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-64 gap-4 text-center p-8">
      <div className="p-4 rounded-full bg-destructive/10">
        <AlertTriangle className="h-8 w-8 text-destructive" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">An error occurred during Step 3 analysis</p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
        {/* Note: Wiener model convergence may fail without sufficient data */}
        <p className="text-xs text-muted-foreground">
          A minimum of 90 days of residual data is required.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={reset} className="gap-1.5">
        <RefreshCw className="h-3.5 w-3.5" />
        Try Again
      </Button>
    </div>
  );
}
