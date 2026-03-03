"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calendar, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MultiPlotPanel } from "@/components/charts/MultiPlotPanel";
import { useWell } from "@/hooks/useWell";
import { useWellData } from "@/hooks/useWellData";
import { useChartStore } from "@/lib/store";

interface WellDetailPageProps {
  params: Promise<{ id: string }>;
}

/** 분석 상태 배지 */
function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    no_data: "데이터 없음",
    data_ready: "데이터 준비됨",
    baseline_set: "베이스라인 설정",
    residual_done: "잔차 분석 완료",
    rul_done: "RUL 예측 완료",
    fully_analyzed: "완전 분석됨",
  };
  return (
    <Badge variant="secondary" className="text-xs">
      {labels[status] ?? status}
    </Badge>
  );
}

/**
 * 날짜 범위 입력 컴포넌트.
 * 브라우저 기본 date input 사용 (외부 라이브러리 없이 간단하게 구현).
 */
function DateRangePicker({
  startDate,
  endDate,
  onChange,
}: {
  startDate: string | null;
  endDate: string | null;
  onChange: (start: string | null, end: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
      <input
        type="date"
        value={startDate ?? ""}
        onChange={(e) => onChange(e.target.value || null, endDate)}
        className="border rounded px-2 py-1 text-xs bg-background"
      />
      <span className="text-muted-foreground">~</span>
      <input
        type="date"
        value={endDate ?? ""}
        onChange={(e) => onChange(startDate, e.target.value || null)}
        className="border rounded px-2 py-1 text-xs bg-background"
      />
      {(startDate || endDate) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => onChange(null, null)}
        >
          초기화
        </Button>
      )}
    </div>
  );
}

/**
 * SCR-003: Well 상세 분석 페이지
 * - 4개 Plot 2x2 그리드 시각화
 * - 날짜 범위 필터 (DateRangePicker ↔ Plotly X축 동기화)
 */
export default function WellDetailPage({ params }: WellDetailPageProps) {
  // Next.js 15: params가 Promise 타입 → use()로 언래핑
  const { id } = use(params);

  const { setDateRange } = useChartStore();
  const [localStart, setLocalStart] = useState<string | null>(null);
  const [localEnd, setLocalEnd] = useState<string | null>(null);

  const { data: well, isLoading: wellLoading } = useWell(id);
  const { data: espData, isLoading: dataLoading } = useWellData({
    wellId: id,
    startDate: localStart,
    endDate: localEnd,
  });

  const handleDateChange = (start: string | null, end: string | null) => {
    setLocalStart(start);
    setLocalEnd(end);
    setDateRange(start, end);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 상단 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>

          {wellLoading ? (
            <Skeleton className="h-6 w-40" />
          ) : (
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <h1 className="text-base font-semibold">{well?.name ?? "Well"}</h1>
              {well && <StatusBadge status={well.analysis_status} />}
            </div>
          )}
        </div>

        {/* 날짜 범위 필터 */}
        <DateRangePicker
          startDate={localStart}
          endDate={localEnd}
          onChange={handleDateChange}
        />
      </div>

      {/* 데이터 요약 정보 */}
      {well && (
        <div className="px-4 py-2 border-b flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0">
          <span>
            데이터: {espData?.total?.toLocaleString() ?? "..."} 행
          </span>
          {espData?.date_range && (
            <span>
              {espData.date_range.start} ~ {espData.date_range.end}
            </span>
          )}
          {dataLoading && <span className="text-primary">로딩 중...</span>}
        </div>
      )}

      {/* 4개 Plot 시각화 영역 */}
      <div className="flex-1 p-4 min-h-0">
        <MultiPlotPanel
          data={espData?.data ?? []}
          isLoading={dataLoading && !espData}
        />
      </div>
    </div>
  );
}
