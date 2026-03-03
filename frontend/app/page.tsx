"use client";

import Link from "next/link";
import { Activity, AlertTriangle, CheckCircle, Clock, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWells } from "@/hooks/useWells";
import type { WellResponse } from "@/lib/api";

/** 분석 상태에 따른 배지 색상 및 라벨 */
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    no_data:        { label: "데이터 없음",     variant: "outline" },
    data_ready:     { label: "데이터 준비됨",   variant: "secondary" },
    baseline_set:   { label: "베이스라인 설정", variant: "default" },
    residual_done:  { label: "잔차 분석 완료",  variant: "default" },
    rul_done:       { label: "RUL 예측 완료",   variant: "default" },
    fully_analyzed: { label: "완전 분석됨",     variant: "default" },
  };
  const { label, variant } = config[status] ?? { label: status, variant: "outline" };
  return <Badge variant={variant}>{label}</Badge>;
}

/** 건강 점수 표시 컴포넌트 */
function HealthGauge({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="text-xs text-muted-foreground">미분석</span>;
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

function WellCard({ well }: { well: WellResponse }) {
  return (
    <Link href={`/wells/${well.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <CardTitle className="text-base">{well.name}</CardTitle>
            <StatusBadge status={well.analysis_status} />
          </div>
          {well.field && (
            <p className="text-xs text-muted-foreground">{well.field}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">건강 점수</span>
            <HealthGauge score={well.latest_health_score} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">데이터 건수</span>
            <span className="text-xs font-medium">
              {well.data_count?.toLocaleString() ?? 0}일
            </span>
          </div>
          {well.date_range && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {well.date_range.start} ~ {well.date_range.end}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * SCR-001: Well 대시보드
 * 전체 Well 목록을 카드 그리드로 표시.
 * 30초마다 자동갱신 (useWells 훅).
 */
export default function DashboardPage() {
  const { data, isLoading, error } = useWells();

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">ESP Performance Analysis</h1>
        </div>
        <Link href="/upload">
          <Button size="sm" className="gap-2">
            <Upload className="h-3 w-3" />
            데이터 업로드
          </Button>
        </Link>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm mb-4 p-3 border border-destructive/30 rounded-md bg-destructive/5">
          <AlertTriangle className="h-4 w-4" />
          백엔드 연결 실패: {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : data?.wells.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <Activity className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground mb-4">등록된 Well이 없습니다.</p>
          <Link href="/upload">
            <Button variant="outline" size="sm">Excel 파일 업로드하기</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data?.wells.map((well) => (
            <WellCard key={well.id} well={well} />
          ))}
        </div>
      )}

      {data && data.wells.length > 0 && (
        <p className="text-xs text-muted-foreground mt-4">
          총 {data.total}개 Well · 30초마다 자동갱신
        </p>
      )}
    </div>
  );
}
