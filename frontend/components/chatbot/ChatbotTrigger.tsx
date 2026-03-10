"use client";

/**
 * 챗봇 플로팅 트리거 버튼
 *
 * - 분석 결과가 없을 때: disabled (툴팁으로 이유 안내)
 * - CRITICAL 알람 시: 빨간 배지 표시 (시각적 긴급 신호)
 * - 클릭 시 ChatbotPanel 열기
 */

import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatbotStore } from "@/lib/chatbot-store";

interface ChatbotTriggerProps {
  /** 분석 결과 없을 때 버튼 비활성화 */
  disabled?: boolean;
  /** "CRITICAL" 전달 시 빨간 배지 표시 */
  alarmStatus?: string | null;
}

export function ChatbotTrigger({ disabled = false, alarmStatus }: ChatbotTriggerProps) {
  const openPanel = useChatbotStore((s) => s.openPanel);

  const isCritical = alarmStatus?.toUpperCase() === "CRITICAL";

  return (
    // 상대 위치: 배지를 버튼 모서리에 겹쳐 표시하기 위함
    <div className="relative inline-flex">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs"
        onClick={openPanel}
        disabled={disabled}
        title={disabled ? "AI Q&A is available after analysis is complete" : "Ask AI about the analysis results"}
      >
        <Bot className="h-3.5 w-3.5" />
        Ask AI
      </Button>

      {/* CRITICAL 알람 배지 — 버튼 우상단에 오버레이 */}
      {isCritical && !disabled && (
        <span
          className="
            absolute -top-1 -right-1
            h-2.5 w-2.5 rounded-full
            bg-red-500 border border-white
            animate-pulse
          "
          aria-label="CRITICAL alarm"
        />
      )}
    </div>
  );
}
