"use client";

/**
 * API 키 입력 화면 컴포넌트
 *
 * 처음 챗봇 패널을 열었을 때 OpenAI API 키를 요청하는 폼.
 * 보안 원칙:
 *   - API 키는 브라우저 localStorage에만 저장 (서버 미전송)
 *   - password 타입 input으로 화면에 노출 방지
 *   - dangerouslyAllowBrowser: true로 클라이언트에서 직접 OpenAI 호출
 */

import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatbotStore } from "@/lib/chatbot-store";

export function ApiKeyInput() {
  const setApiKey = useChatbotStore((s) => s.setApiKey);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    // 기본 형식 검증: sk- 로 시작해야 함
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Please enter your API key.");
      return;
    }
    if (!trimmed.startsWith("sk-")) {
      setError("Invalid API key. It must start with 'sk-'.");
      return;
    }
    setError(null);
    setApiKey(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter로 바로 저장 가능
    if (e.key === "Enter") handleSave();
  };

  return (
    // 패널 중앙에 배치하는 컨테이너
    <div className="flex flex-col items-center justify-center flex-1 px-6 py-8 gap-5">
      {/* 아이콘 + 제목 */}
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="p-3 rounded-full bg-primary/10">
          <KeyRound className="h-6 w-6 text-primary" />
        </div>
        <h3 className="font-semibold text-sm">OpenAI API Key Required</h3>
        <p className="text-xs text-muted-foreground max-w-[260px]">
          An OpenAI API key is required to interpret ESP analysis results with AI.
        </p>
      </div>

      {/* 키 입력 폼 */}
      <div className="w-full space-y-2">
        <Input
          type="password"
          placeholder="sk-..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="text-sm font-mono"
          autoComplete="off"
        />
        {/* 에러 메시지 */}
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
        <Button className="w-full gap-2" onClick={handleSave}>
          <KeyRound className="h-4 w-4" />
          Save API Key
        </Button>
      </div>

      {/* 보안 안내 */}
      <div className="flex items-start gap-2 bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground w-full">
        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-green-600" />
        <span>
          Your API key is stored only in browser local storage and never sent to our server.
          AI requests are made directly from your browser to OpenAI.
        </span>
      </div>
    </div>
  );
}
