/**
 * Well detail common layout
 *
 * Shared layout for all /wells/[id]/* routes:
 * - Header: back button, well name, analysis status badge
 * - Tab navigation: Raw Data / Step 1 / Step 2 / Step 3
 * - children: content for each tab
 *
 * Implemented as a server component (data fetching + layout structure).
 * Tab activation (usePathname) is split into a client sub-component.
 */

import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/analysis/StatusBadge";
import { getWell } from "@/lib/api";
import { WellTabs } from "./_components/WellTabs";
import { ExportButton } from "./_components/ExportButton";

interface WellLayoutProps {
  children: React.ReactNode;
  // Next.js 16: params is a Promise type – await is required
  params: Promise<{ id: string }>;
}

export default async function WellLayout({ children, params }: WellLayoutProps) {
  // Next.js 16 App Router: params must be handled asynchronously
  const { id } = await params;

  // Fetch well info directly on the server to display in the header.
  // If the well ID does not exist, Next.js automatically renders a 404 page.
  let well;
  try {
    well = await getWell(id);
  } catch {
    notFound();
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top header: well identification info */}
      <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Back to dashboard */}
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>

          {/* Well identification info */}
          <Activity className="h-4 w-4 text-primary" />
          <h1 className="text-base font-semibold">{well.name}</h1>
          <StatusBadge status={well.analysis_status} />
        </div>

        {/* 우측: 날짜 범위 + CSV Export 버튼 */}
        <div className="flex items-center gap-3">
          {well.date_range && (
            <span className="text-xs text-muted-foreground">
              {well.date_range.start} ~ {well.date_range.end}
            </span>
          )}
          {/* 데이터가 없을 때는 비활성화, data_ready 이상일 때 활성화 */}
          <ExportButton wellId={id} analysisStatus={well.analysis_status} />
        </div>
      </div>

      {/* Step tab navigation (client component – requires usePathname) */}
      <WellTabs wellId={id} analysisStatus={well.analysis_status} />

      {/* Content area for each page.
          Suspense를 명시적으로 추가하는 이유: loading.tsx가 동일 레벨에 존재하면
          Next.js가 서버 SSR 시 이 위치에 <Suspense>를 자동 삽입하므로,
          클라이언트 React 트리에도 같은 구조가 있어야 hydration mismatch를 방지함. */}
      <Suspense>
        <div className="flex-1 min-h-0 overflow-auto">
          {children}
        </div>
      </Suspense>
    </div>
  );
}
