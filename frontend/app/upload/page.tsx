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
 * SCR-002: Excel File Upload Page
 * - Supports drag-and-drop + file selection
 * - Shows upload progress via XMLHttpRequest
 * - Invalidates the well list cache after a successful upload
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
        // Invalidate the well list cache so the dashboard refreshes automatically
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
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">Data Upload</h1>
      </div>

      {/* Drag-and-drop area */}
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
              Supports .xlsx, .xls · Max 50MB
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

      {/* Upload progress */}
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

      {/* Upload success result */}
      {uploadState === "success" && result && (
        <Card className="mb-4 border-green-200 bg-green-50 dark:bg-green-950/20">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <CardTitle className="text-base text-green-700 dark:text-green-400">
                Upload Complete
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Well Name</span>
              <span className="font-medium">{result.well_name}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Records Inserted</span>
              <Badge variant="secondary">{result.records_inserted} rows</Badge>
            </div>
            {result.date_range && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Date Range</span>
                <span className="text-xs">
                  {result.date_range.start} ~ {result.date_range.end}
                </span>
              </div>
            )}

            {/* Warning messages */}
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

            {/* Navigation buttons */}
            <div className="flex gap-2 mt-4">
              <Button
                size="sm"
                onClick={() => router.push(`/wells/${result.well_id}`)}
              >
                View Well Details
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
                Upload Another File
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
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

      {/* Instructions */}
      <div className="text-xs text-muted-foreground space-y-1 mt-4">
        <p>• Upload a file in Production Data.xlsx format</p>
        <p>• Existing data for the same well will be overwritten by date</p>
        <p>• Well names are normalised automatically (e.g. LF12-3 A1H → LF12-3-A1H)</p>
      </div>
    </div>
  );
}
