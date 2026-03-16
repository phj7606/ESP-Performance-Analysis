"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { uploadFile, type UploadResponse } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

type UploadState = "idle" | "uploading" | "success" | "error";

/**
 * SCR-002: Excel File Upload Page
 * - 드래그앤드롭 + 파일 선택 지원
 * - XMLHttpRequest 기반 업로드 진행률 표시
 * - 멀티 시트: 업로드 완료 후 발견된 모든 Well 목록 표시
 * - 업로드 완료 후 Well 목록 캐시 무효화
 */
export default function UploadPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".xlsx") && !file.name.toLowerCase().endsWith(".xls")) {
        setErrorMessage("Only Excel files (.xlsx, .xls) can be uploaded.");
        setUploadState("error");
        return;
      }

      setUploadState("uploading");
      setProgress(0);
      setResult(null);
      setErrorMessage(null);

      try {
        const response = await uploadFile(file, (pct) => setProgress(pct));
        setResult(response);
        setUploadState("success");
        // 업로드 완료 후 Well 목록 캐시 무효화 → 대시보드 자동 갱신
        await queryClient.invalidateQueries({ queryKey: ["wells"] });
      } catch (err) {
        setErrorMessage((err as Error).message);
        setUploadState("error");
      }
    },
    [queryClient]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">Data Upload</h1>
      </div>

      {/* 드래그앤드롭 영역 */}
      <Card
        className={`mb-4 cursor-pointer transition-colors ${
          isDragOver ? "border-primary bg-primary/5" : "border-dashed"
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => uploadState !== "uploading" && fileInputRef.current?.click()}
      >
        <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
          <div className={`p-4 rounded-full ${isDragOver ? "bg-primary/10" : "bg-muted"}`}>
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">
              {isDragOver ? "Drop the file here" : "Drag an Excel file here or click to select"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Supports .xlsx, .xls · Max 50MB · Multi-sheet supported
            </p>
          </div>
          {uploadState === "idle" && (
            <Button variant="outline" size="sm" className="mt-2">
              <Upload className="h-3 w-3 mr-2" />
              Select File
            </Button>
          )}
        </CardContent>
      </Card>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 업로드 진행률 */}
      {uploadState === "uploading" && (
        <Card className="mb-4">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm">Uploading...</span>
              <span className="text-sm text-muted-foreground">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* 업로드 완료 결과: 멀티 Well 지원 */}
      {uploadState === "success" && result && (
        <Card className="mb-4 border-green-200 bg-green-50 dark:bg-green-950/20">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <CardTitle className="text-base text-green-700 dark:text-green-400">
                  Upload Complete
                </CardTitle>
              </div>
              {/* 전체 요약 */}
              <div className="flex gap-2">
                <Badge variant="secondary">{result.total_wells} well(s)</Badge>
                <Badge variant="secondary">{result.total_records} rows</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Well 별 결과 목록 */}
            {result.wells.map((well) => (
              <div
                key={well.well_id}
                className="rounded-md border border-green-200 bg-white dark:bg-green-950/30 p-3 space-y-1"
              >
                {/* Well 이름 + 상세 이동 링크 */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{well.well_name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => router.push(`/wells/${well.well_id}`)}
                  >
                    View Details
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </Button>
                </div>

                {/* 적재 건수 + 날짜 범위 */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{well.records_inserted} rows inserted</span>
                  {well.date_range && (
                    <span>{well.date_range.start} ~ {well.date_range.end}</span>
                  )}
                </div>

                {/* 경고 메시지 (있을 경우) */}
                {well.warnings.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {well.warnings.map((w, i) => (
                      <div key={i} className="flex items-center gap-1 text-xs text-yellow-600">
                        <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                        {w}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* 단일 Well인 경우 Well 상세 바로가기, 복수인 경우 대시보드 이동 */}
            <div className="flex gap-2 mt-4">
              {result.total_wells === 1 ? (
                <Button
                  size="sm"
                  onClick={() => router.push(`/wells/${result.wells[0].well_id}`)}
                >
                  View Well Details
                </Button>
              ) : (
                <Button size="sm" onClick={() => router.push("/")}>
                  View All Wells
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setUploadState("idle");
                  setResult(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                Upload Another File
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 에러 상태 */}
      {uploadState === "error" && errorMessage && (
        <Card className="mb-4 border-destructive/30 bg-destructive/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <p className="text-sm">{errorMessage}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setUploadState("idle");
                setErrorMessage(null);
              }}
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 사용 안내 */}
      <div className="text-xs text-muted-foreground space-y-1 mt-4">
        <p>• Upload a file in Production Data.xlsx format</p>
        <p>• All sheets will be processed — each sheet&apos;s Well data is loaded individually</p>
        <p>• Existing data for the same well will be overwritten by date</p>
        <p>• Well names are normalised automatically (e.g. LF12-3 A1H → LF12-3-A1H)</p>
      </div>
    </div>
  );
}
