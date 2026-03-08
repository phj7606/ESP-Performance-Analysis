/**
 * Step 1 page loading skeleton
 */

import { Skeleton } from "@/components/ui/skeleton";

export default function Step1Loading() {
  return (
    <div className="p-4 space-y-4">
      {/* Section header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-80" />
        </div>
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
      {/* Chart skeleton */}
      <Skeleton className="h-64 w-full rounded-lg" />
      {/* Table skeleton */}
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    </div>
  );
}
