/**
 * Step 2-B 페이지 로딩 스켈레톤
 */

import { Skeleton } from "@/components/ui/skeleton";

export default function Step2bLoading() {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-3 w-96" />
        </div>
        <Skeleton className="h-8 w-36 rounded-md" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="col-span-2 h-72 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
