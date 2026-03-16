"use client";

/**
 * Well detail tab navigation component
 *
 * Displays Raw Data, Step 1, Step 2, and Step 3 tabs.
 * - Uses usePathname to detect the currently active tab
 * - Uses canRunStep to determine whether each Step tab is accessible
 *   (inaccessible tabs are visually dimmed but still clickable)
 *
 * Reason for extracting into a client component:
 * usePathname reads the browser URL and cannot be used in server components.
 * layout.tsx remains a server component while only the tab portion is a client component.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { canRunStep, isStepComplete } from "@/lib/workflow";
import { CheckCircle2, Circle } from "lucide-react";

interface WellTabsProps {
  wellId: string;
  analysisStatus: string;
}

interface TabConfig {
  label: string;
  href: string;
  /** Step number (0: Raw Data, "2b": Step 2-B, others: Step N) */
  step: 0 | 1 | 2 | 3 | "2b";
  /** canRunStep에 사용할 실제 숫자 (step이 "2b"인 경우 3으로 매핑) */
  requiredStatus?: number;
}

export function WellTabs({ wellId, analysisStatus }: WellTabsProps) {
  const pathname = usePathname();

  const tabs: TabConfig[] = [
    {
      label: "Raw Data",
      href: `/wells/${wellId}`,
      step: 0,
    },
    {
      label: "Step 1. Performance Diagnosis",
      href: `/wells/${wellId}/step/1`,
      step: 1,
    },
    {
      label: "Step 2. Trend Analysis",
      href: `/wells/${wellId}/step/2`,
      step: 2,
    },
    {
      label: "Step 2-B. Trend Analysis (GMM)",
      href: `/wells/${wellId}/step/2b`,
      step: "2b",
      requiredStatus: 2,   // diagnosis_done(2) 이상이면 접근 가능 (Step 2와 동일 조건)
    },
    {
      label: "Step 3. Fault Alarm Mode",
      href: `/wells/${wellId}/step/3`,
      step: 3,
    },
  ];

  /**
   * Determine whether a tab is active.
   * Raw Data tab: active only when the path is exactly /wells/{id} (excludes sub-routes)
   * Step tabs: active when the path is /wells/{id}/step/{N}
   */
  function isActive(tab: TabConfig): boolean {
    if (tab.step === 0) {
      return pathname === `/wells/${wellId}`;
    }
    return pathname === tab.href || pathname.startsWith(tab.href + "/");
  }

  return (
    // Tab bar: separated from the content area by a bottom border
    <div className="flex items-center border-b px-4 gap-0 flex-shrink-0 bg-background">
      {tabs.map((tab) => {
        const active = isActive(tab);
        // Step 0은 항상 접근 가능. Step N은 canRunStep으로 확인.
        // Step 2-B는 requiredStatus(3=health_done)를 사용하여 별도 검사.
        const stepForCheck = tab.requiredStatus ?? (tab.step === "2b" ? 3 : tab.step as number);
        const accessible   = tab.step === 0 || canRunStep(analysisStatus, stepForCheck);
        // 완료 아이콘: Step 2-B는 완료 상태 없음(보조 분석이므로 workflow 미갱신)
        const completed = typeof tab.step === "number" && tab.step > 0
          && isStepComplete(analysisStatus, tab.step);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              // Tab base style
              "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px",
              // Active tab: primary colour + bottom border emphasis
              active
                ? "border-primary text-primary"
                : "border-transparent",
              // Inaccessible tab: dimmed text
              !accessible && !active
                ? "text-muted-foreground/50"
                : !active
                ? "text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
                : ""
            )}
          >
            {/* Step 완료 아이콘: 숫자 step만 표시 (Step 2-B는 보조 분석으로 제외) */}
            {typeof tab.step === "number" && tab.step > 0 && (
              completed
                ? <CheckCircle2 className="h-3 w-3 text-green-500" />
                : <Circle className="h-3 w-3" />
            )}
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
