"use client";

/**
 * 챗봇 입력창 컴포넌트
 *
 * - Textarea 기반 (자동 높이 조절을 위해 shadcn/ui Textarea 사용)
 * - Enter: 전송, Shift+Enter: 줄바꿈 (멀티라인 입력 지원)
 * - 스트리밍 중 disabled (중복 전송 방지)
 * - 빈 메시지 전송 방지
 */

import { useState, useRef } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
  onSend: (text: string) => void;
  /** 스트리밍 진행 중 여부 — true면 입력 비활성화 */
  isLoading: boolean;
}

export function ChatInput({ onSend, isLoading }: ChatInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    onSend(trimmed);
    setText("");
    // 전송 후 입력창에 포커스 복귀
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter는 줄바꿈 허용, 일반 Enter만 전송
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    // 입력창 + 전송 버튼 가로 배치
    <div className="border-t px-3 py-3 flex items-end gap-2">
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isLoading ? "Generating response..." : "Type a message... (Enter to send)"}
        disabled={isLoading}
        rows={2}
        className="
          flex-1 resize-none text-sm min-h-[56px] max-h-[120px]
          disabled:opacity-60 disabled:cursor-not-allowed
        "
      />
      {/* 전송 버튼 — 내용 없거나 스트리밍 중이면 비활성 */}
      <Button
        size="icon"
        onClick={handleSend}
        disabled={!text.trim() || isLoading}
        className="shrink-0 h-10 w-10"
        aria-label="Send message"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
