/**
 * Well detail loading UI
 *
 * Suspense skeleton displayed while layout.tsx fetches well data on the server.
 * Uses animate-pulse to show a smooth loading state without layout shift.
 */

import { Skeleton } from "@/components/ui/skeleton";

export default function WellDetailLoading() {
  return (
    <div className="flex flex-col h-full">
      {/* Header skeleton */}
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <Skeleton className="h-7 w-7 rounded-md" />
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>

      {/* Tab skeleton */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-b">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-4 w-24" />
        ))}
      </div>

      {/* Chart area skeleton */}
      <div className="flex-1 p-4 grid grid-cols-2 grid-rows-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="rounded-lg" />
        ))}
      </div>
    </div>
  );
}
