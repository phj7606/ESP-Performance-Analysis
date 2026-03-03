"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { uploadFile, type UploadResponse } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

type UploadState = "idle" | "uploading" | "success" | "error";

/**
 * SCR-002: Excel 파일 업로드 페이지
 * - 드래그앤드롭 + 파일 선택 지원
 * - XMLHttpRequest로 업로드 진행률 표시
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
        setErrorMessage("Excel 파일(.xlsx, .xls)만 업로드할 수 있습니다.");
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
        // Well 목록 캐시 무효화 → 대시보드 자동 갱신
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
        <h1 className="text-xl font-semibold">데이터 업로드</h1>
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
              {isDragOver ? "파일을 놓으세요" : "Excel 파일을 드래그하거나 클릭하여 선택"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              .xlsx, .xls 파일 지원 · 최대 50MB
            </p>
          </div>
          {uploadState === "idle" && (
            <Button variant="outline" size="sm" className="mt-2">
              <Upload className="h-3 w-3 mr-2" />
              파일 선택
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
              <span className="text-sm">업로드 중...</span>
              <span className="text-sm text-muted-foreground">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* 업로드 성공 결과 */}
      {uploadState === "success" && result && (
        <Card className="mb-4 border-green-200 bg-green-50 dark:bg-green-950/20">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <CardTitle className="text-base text-green-700 dark:text-green-400">
                업로드 완료
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Well 이름</span>
              <span className="font-medium">{result.well_name}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">적재 행수</span>
              <Badge variant="secondary">{result.records_inserted}행</Badge>
            </div>
            {result.date_range && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">날짜 범위</span>
                <span className="text-xs">
                  {result.date_range.start} ~ {result.date_range.end}
                </span>
              </div>
            )}

            {/* 경고 메시지 */}
            {result.warnings.length > 0 && (
              <div className="mt-3 space-y-1">
                {result.warnings.map((w, i) => (
                  <div key={i} className="flex items-center gap-1 text-xs text-yellow-600">
                    <AlertTriangle className="h-3 w-3" />
                    {w}
                  </div>
                ))}
              </div>
            )}

            {/* 이동 버튼 */}
            <div className="flex gap-2 mt-4">
              <Button
                size="sm"
                onClick={() => router.push(`/wells/${result.well_id}`)}
              >
                Well 상세 보기
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setUploadState("idle");
                  setResult(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                다른 파일 업로드
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
              다시 시도
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 안내 사항 */}
      <div className="text-xs text-muted-foreground space-y-1 mt-4">
        <p>• Production Data.xlsx 형식의 파일을 업로드하세요</p>
        <p>• 동일 Well의 기존 데이터는 날짜 기준으로 덮어씁니다</p>
        <p>• Well 이름은 자동으로 정규화됩니다 (예: LF12-3 A1H → LF12-3-A1H)</p>
      </div>
    </div>
  );
}
