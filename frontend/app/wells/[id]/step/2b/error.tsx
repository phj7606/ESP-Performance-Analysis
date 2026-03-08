"use client";

/**
 * Step 2-B 오류 UI
 * error.tsx는 'use client' 지시문이 필요함.
 */

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Step2bError({ error, reset }: ErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-64 gap-4 text-center p-8">
      <div className="p-4 rounded-full bg-destructive/10">
        <AlertTriangle className="h-8 w-8 text-destructive" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Step 2-B 분석 중 오류 발생</p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={reset} className="gap-1.5">
        <RefreshCw className="h-3.5 w-3.5" />
        다시 시도
      </Button>
    </div>
  );
}
