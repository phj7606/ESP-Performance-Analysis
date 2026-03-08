"use client";

/**
 * Well detail error UI
 *
 * Displayed when an error occurs in layout.tsx or page.tsx.
 * error.tsx requires the 'use client' directive (Next.js rule).
 * 404 cases (well not found) are handled by notFound() in layout.tsx.
 * This component handles unexpected errors such as network failures.
 */

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function WellDetailError({ error, reset }: ErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 text-center p-8">
      <div className="p-4 rounded-full bg-destructive/10">
        <AlertTriangle className="h-8 w-8 text-destructive" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Unable to load well data</p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
        {/* Error digest is used for server log tracing */}
        {error.digest && (
          <p className="text-xs text-muted-foreground/50">Error code: {error.digest}</p>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={reset} className="gap-1.5">
        <RefreshCw className="h-3.5 w-3.5" />
        Try Again
      </Button>
    </div>
  );
}
