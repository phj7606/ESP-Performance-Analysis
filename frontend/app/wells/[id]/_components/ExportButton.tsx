"use client";

/**
 * CSV Export 버튼 컴포넌트 (클라이언트 전용)
 * - analysis_status가 'data_ready' 이상일 때 활성화
 * - 클릭 시 /api/wells/{id}/export 에서 CSV 다운로드
 * - 서버 컴포넌트(layout.tsx)에서 분리한 이유: useState/이벤트 핸들러 사용
 */

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportCsv } from "@/lib/api";
import { toast } from "sonner";

interface ExportButtonProps {
  wellId: string;
  /** 'no_data'이면 비활성화, 나머지 상태에선 활성화 */
  analysisStatus: string;
}

export function ExportButton({ wellId, analysisStatus }: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  // 데이터가 전혀 없는 초기 상태에서는 Export 불가
  const isDisabled = analysisStatus === "no_data" || isExporting;

  async function handleExport() {
    setIsExporting(true);
    try {
      await exportCsv(wellId);
      toast.success("CSV 파일이 다운로드 되었습니다.");
    } catch (err) {
      toast.error(`Export 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={isDisabled}
      /* 로딩 중 시각적 피드백을 위해 opacity 조정 */
      className="h-7 gap-1.5 text-xs"
    >
      <Download className="h-3.5 w-3.5" />
      {isExporting ? "내보내는 중..." : "CSV Export"}
    </Button>
  );
}
