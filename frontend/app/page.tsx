"use client";

/**
 * SCR-001: Well Dashboard
 *
 * Displays the full list of wells in a card grid.
 * - Per-well analysis status badge + Step 1~3 progress bar
 * - Overall analysis statistics (number of wells that completed Step 3)
 * - Auto-refreshes every 30 seconds
 */

import Link from "next/link";
import {
  Activity, AlertTriangle, CheckCircle, Clock, Upload,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/analysis/StatusBadge";
import { useWells } from "@/hooks/useWells";
import { isStepComplete, STATUS_ORDER } from "@/lib/workflow";
import { cn } from "@/lib/utils";
import type { WellResponse } from "@/lib/api";

/**
 * Health score display component
 */
function HealthGauge({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="text-xs text-muted-foreground">Not Analysed</span>;
  }
  const color =
    score >= 70 ? "text-green-500" : score >= 40 ? "text-yellow-500" : "text-red-500";

  return (
    <div className="flex items-center gap-1">
      {score >= 70 ? (
        <CheckCircle className="h-3 w-3 text-green-500" />
      ) : (
        <AlertTriangle className="h-3 w-3 text-yellow-500" />
      )}
      <span className={`text-sm font-semibold ${color}`}>{score.toFixed(0)}</span>
      <span className="text-xs text-muted-foreground">/ 100</span>
    </div>
  );
}

/**
 * Step 1~3 progress bar.
 * Visualises completion of each step using 3 segments.
 * Completed steps are shown in primary colour; incomplete steps are muted.
 */
function WellStepProgress({ status }: { status: string }) {
  const steps = [1, 2, 3] as const;

  return (
    <div className="space-y-1">
      <div className="flex gap-0.5">
        {steps.map((step) => (
          <div
            key={step}
            className={cn(
              "flex-1 h-1.5 rounded-full transition-colors",
              isStepComplete(status, step) ? "bg-primary" : "bg-muted"
            )}
            title={`Step ${step}${isStepComplete(status, step) ? " Complete" : " Incomplete"}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground px-0.5">
        <span>S1</span>
        <span>S2</span>
        <span>S3</span>
      </div>
    </div>
  );
}

/**
 * Well card component.
 * Clicking navigates to the well detail page (/wells/{id}).
 */
function WellCard({ well }: { well: WellResponse }) {
  return (
    <Link href={`/wells/${well.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-tight">{well.name}</CardTitle>
            {/* Uses the shared StatusBadge component */}
            <StatusBadge status={well.analysis_status} />
          </div>
          {well.field && (
            <p className="text-xs text-muted-foreground">{well.field}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Health score */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Health Score</span>
            <HealthGauge score={well.latest_health_score} />
          </div>

          {/* Data count */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Data Count</span>
            <span className="text-xs font-medium">
              {well.data_count?.toLocaleString() ?? 0} days
            </span>
          </div>

          {/* Date range */}
          {well.date_range && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {well.date_range.start} ~ {well.date_range.end}
            </div>
          )}

          {/* Step progress bar */}
          <WellStepProgress status={well.analysis_status} />
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * Overall analysis statistics banner.
 * Shows the number of wells that completed Step 3 (rul_done) and whether Step 4 is runnable.
 */
function AnalysisSummaryBanner({
  wells,
  total,
}: {
  wells: WellResponse[];
  total: number;
}) {
  // Number of wells at fully_analyzed (score >= 4)
  const step3DoneCount = wells.filter(
    (w) => (STATUS_ORDER[w.analysis_status] ?? 0) >= 4
  ).length;
  const allDone = step3DoneCount === total && total > 0;

  return (
    <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 border text-xs">
      {/* Statistics display */}
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Fault Alarm Ready:</span>
        <span className="font-semibold text-foreground">
          {step3DoneCount} / {total}
        </span>
      </div>

      {/* Overall completion badge */}
      {allDone ? (
        <div className="flex items-center gap-1.5 text-green-600">
          <CheckCircle className="h-3 w-3" />
          All Analysis Complete
        </div>
      ) : (
        <span className="text-muted-foreground">
          {total - step3DoneCount} well(s) pending
        </span>
      )}

    </div>
  );
}

/**
 * SCR-001: Well Dashboard main page
 */
export default function DashboardPage() {
  const { data, isLoading, error } = useWells();

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">ESP Performance Analysis</h1>
        </div>
        <Link href="/upload">
          <Button size="sm" className="gap-2">
            <Upload className="h-3 w-3" />
            Upload Data
          </Button>
        </Link>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm mb-4 p-3 border border-destructive/30 rounded-md bg-destructive/5">
          <AlertTriangle className="h-4 w-4" />
          Backend connection failed: {(error as Error).message}
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full rounded-lg" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-52 rounded-lg" />
            ))}
          </div>
        </div>
      ) : data?.wells.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <Activity className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground mb-4">No wells registered.</p>
          <Link href="/upload">
            <Button variant="outline" size="sm">Upload Excel File</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Overall analysis statistics banner */}
          {data && (
            <AnalysisSummaryBanner wells={data.wells} total={data.total} />
          )}

          {/* Well card grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {data?.wells.map((well) => (
              <WellCard key={well.id} well={well} />
            ))}
          </div>
        </div>
      )}

      {/* Bottom meta information */}
      {data && data.wells.length > 0 && (
        <p className="text-xs text-muted-foreground mt-4">
          {data.total} well(s) total · Auto-refreshes every 30 seconds
        </p>
      )}
    </div>
  );
}
