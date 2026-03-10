"use client";

/**
 * 챗봇 메시지 목록 컴포넌트
 *
 * - user/assistant 버블 레이아웃 (user: 우측, assistant: 좌측)
 * - isStreaming=true 시 커서 깜빡임 (▋ animate-pulse)
 * - 새 메시지 추가 시 자동 스크롤 (useEffect + scrollRef)
 * - assistant 메시지는 react-markdown으로 마크다운 렌더링
 *   (코드 블록, 볼드, 목록 등 포함)
 */

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatMessage } from "@/lib/chatbot-store";

interface MessageListProps {
  messages: ChatMessage[];
}

// ============================================================
// 개별 메시지 버블
// ============================================================

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";

  return (
    // user: 우측 정렬, assistant: 좌측 정렬
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`
          max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm
          ${isUser
            // 사용자 메시지: 주색 배경 + 흰 텍스트
            ? "bg-primary text-primary-foreground rounded-br-sm"
            // 어시스턴트 메시지: 연한 배경 + 기본 텍스트
            : "bg-muted text-foreground rounded-bl-sm"
          }
        `}
      >
        {isUser ? (
          // 사용자 메시지: 일반 텍스트 (줄바꿈 보존)
          <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
        ) : (
          // 어시스턴트 메시지: 마크다운 렌더링
          <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown>{msg.content || " "}</ReactMarkdown>
            {/* 스트리밍 중 커서 깜빡임 — after pseudo보다 인라인 span이 안정적 */}
            {msg.isStreaming && (
              <span className="inline-block w-[0.6em] h-[1em] ml-0.5 bg-foreground/70 animate-pulse align-text-bottom" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 메시지 목록 (ScrollArea 포함)
// ============================================================

export function MessageList({ messages }: MessageListProps) {
  // 새 메시지 추가 시 맨 아래로 자동 스크롤
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    // 아직 메시지가 없을 때 안내 문구
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-xs text-muted-foreground text-center px-4">
          Ask a question about the analysis results.
          <br />
          AI will answer based on the ESP performance data.
        </p>
      </div>
    );
  }

  return (
    // flex-1: 남은 공간 모두 차지 → ChatInput이 하단에 고정
    <ScrollArea className="flex-1 px-3">
      <div className="py-3">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {/* 스크롤 앵커 */}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
