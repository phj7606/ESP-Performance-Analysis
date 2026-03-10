"use client";

/**
 * 챗봇 메인 패널 컴포넌트
 *
 * shadcn/ui Sheet를 우측 슬라이드 패널로 사용.
 * 스트리밍 흐름:
 *   1. 사용자 메시지 추가
 *   2. assistant 빈 메시지(isStreaming=true) 추가
 *   3. OpenAI SSE 스트림에서 delta를 appendToLastMessage로 누적
 *   4. 스트림 완료 시 markStreamingComplete로 커서 제거
 *
 * 자동 초기 메시지 (vision 업그레이드):
 *   패널 열리고 API 키가 있고 대화가 비어있으면 initialMessage를 자동 전송.
 *   → 화면 캡처(html2canvas) 후 VISION_MODEL로 전송 → 차트 시각 분석 포함 요약.
 *   → 후속 Q&A는 QA_MODEL(경량 모델)로 처리하여 비용 절감.
 */

import { useEffect, useRef } from "react";
import OpenAI from "openai";
import { Trash2, X, KeyRound } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ApiKeyInput } from "./ApiKeyInput";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { useChatbotStore } from "@/lib/chatbot-store";

// ============================================================
// 모델 상수 — 역할에 따라 모델 분리하여 비용 최적화
// ============================================================

/**
 * VISION_MODEL: 패널 최초 열림 시 화면 캡처 + 시각 분석에 사용.
 * 차트 이미지 해석 품질이 중요하므로 vision 지원 최신 모델 선택.
 */
const VISION_MODEL = "gpt-5";        // vision + streaming 지원

/**
 * QA_MODEL: 후속 텍스트 Q&A에 사용.
 * 초기 분석 이후 대화는 텍스트만 오가므로 경량 모델로 비용 절감.
 */
const QA_MODEL    = "gpt-5-mini";    // 텍스트 대화 충분, 비용 효율

// ============================================================
// 스크린샷 캡처 유틸리티
// ============================================================

/**
 * id="step-result-area" 요소를 JPEG 이미지로 캡처.
 *
 * - html2canvas를 동적 import: 초기 번들 크기 증가 방지
 * - scale: 1 → retina 2x 불필요, 토큰 절감
 * - JPEG 75%: PNG 대비 토큰 ~60% 절감 (차트 품질 유지 수준)
 * - 실패 시 null 반환 → 텍스트 전용 폴백으로 안전 처리
 */
async function captureScreenshot(): Promise<string | null> {
  const el = document.getElementById("step-result-area");
  if (!el) return null;
  try {
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(el, {
      useCORS: true,        // Plotly SVG의 외부 리소스 CORS 허용
      scale: 1,             // 1x 해상도 (토큰 절감 목적)
      logging: false,       // 불필요한 콘솔 로그 억제
      backgroundColor: null,
    });
    // JPEG 75% 품질 — PNG 대비 토큰 ~60% 절감
    return canvas.toDataURL("image/jpeg", 0.75);
  } catch {
    // 캡처 실패 시 텍스트 전용으로 폴백 (사용자 경험 유지)
    return null;
  }
}

// ============================================================
// 컴포넌트 Props 타입
// ============================================================

interface ChatbotPanelProps {
  /** Step 구분 — 패널 제목에 표시 */
  stepNumber: 1 | 2 | 3;
  wellId: string;
  /** LLM 시스템 프롬프트 (buildStepNSystemPrompt 결과) */
  systemPrompt: string;
  /** 패널 열릴 때 자동 전송할 초기 사용자 메시지 */
  initialMessage: string;
}

const STEP_TITLES: Record<1 | 2 | 3, string> = {
  1: "Step 1. Performance Diagnosis AI",
  2: "Step 2. Health Score AI",
  3: "Step 3. Failure Mode AI",
};

export function ChatbotPanel({
  stepNumber,
  wellId,
  systemPrompt,
  initialMessage,
}: ChatbotPanelProps) {
  const {
    apiKey, clearApiKey,
    isPanelOpen, closePanel,
    conversations, addMessage, appendToLastMessage, markStreamingComplete, clearConversation,
  } = useChatbotStore();

  // 대화 키: wellId + stepNumber 조합으로 Step별 독립 스레드 유지
  const convKey  = `${wellId}_step${stepNumber}`;
  const messages = conversations[convKey] ?? [];

  // 스트리밍 진행 중 여부 (마지막 메시지가 assistant + isStreaming)
  const lastMsg     = messages[messages.length - 1];
  const isStreaming  = lastMsg?.role === "assistant" && lastMsg?.isStreaming === true;

  // 초기 메시지 중복 발송 방지용 플래그
  const initialSentRef = useRef(false);

  // ============================================================
  // 후속 Q&A: 텍스트 전용 스트리밍 전송
  // ============================================================

  async function handleSend(userText: string) {
    if (!apiKey) return;

    // 사용자 메시지 추가
    addMessage(convKey, {
      id: crypto.randomUUID(),
      role: "user",
      content: userText,
    });

    // assistant 빈 메시지 미리 추가 (스트리밍 시 이 메시지에 delta 누적)
    addMessage(convKey, {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      isStreaming: true,
    });

    try {
      // dangerouslyAllowBrowser: API 키를 브라우저에서 직접 사용 (Next.js 백엔드 프록시 없이)
      const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });

      // 최근 20개 메시지만 전송 (컨텍스트 윈도우 비용 절감)
      const history = conversations[convKey] ?? [];
      const historyToSend = history
        .slice(-20)
        .filter((m) => !m.isStreaming)        // 스트리밍 중인 빈 메시지 제외
        .map((m) => ({ role: m.role, content: m.content }));

      const stream = await client.chat.completions.create({
        // 후속 Q&A: 텍스트만 오가므로 경량 모델로 비용 절감
        model: QA_MODEL,
        messages: [
          // 시스템 프롬프트에 분석 결과 컨텍스트 주입
          { role: "system" as const, content: systemPrompt },
          ...historyToSend,
          { role: "user" as const, content: userText },
        ],
        stream: true,
        temperature: 0.3,   // 낮은 temperature: 전문적이고 일관된 답변
        max_tokens: 1000,
      });

      // SSE 스트림 수신: delta를 마지막 assistant 메시지에 누적
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) {
          appendToLastMessage(convKey, delta);
        }
      }
    } catch (err) {
      // API 오류 시 에러 메시지를 assistant 말풍선에 표시
      const errorMsg =
        err instanceof Error ? err.message : "An unknown error occurred.";
      appendToLastMessage(convKey, `\n\n⚠️ Error: ${errorMsg}`);
    } finally {
      // 성공/실패 모두 스트리밍 커서 제거
      markStreamingComplete(convKey);
    }
  }

  // ============================================================
  // 초기 요약: 화면 캡처 포함 vision 메시지 전송
  // ============================================================

  /**
   * 패널 최초 열림 시 호출되는 vision 전송 함수.
   *
   * 1. UI에는 텍스트 메시지만 표시 (base64 이미지는 말풍선에 노출 안 함)
   * 2. 스크린샷 캡처 성공 시 image_url + text 다중 컨텐츠로 GPT 전송
   * 3. 캡처 실패 시 텍스트 단독 전송으로 폴백 — 서비스 중단 없음
   * 4. VISION_MODEL 사용 (시각 분석 품질 우선)
   */
  async function handleSendWithVision(userText: string) {
    if (!apiKey) return;

    // UI에는 텍스트만 표시 (base64 이미지는 채팅창에 불필요)
    addMessage(convKey, { id: crypto.randomUUID(), role: "user", content: userText });
    addMessage(convKey, { id: crypto.randomUUID(), role: "assistant", content: "", isStreaming: true });

    try {
      const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });

      // 스크린샷 캡처 — 실패해도 null 반환으로 안전 처리
      const screenshot = await captureScreenshot();

      // vision 메시지 타입: 스크린샷 있으면 image+text 배열, 없으면 문자열
      type VisionContent = string | Array<
        | { type: "image_url"; image_url: { url: string; detail: "high" } }
        | { type: "text"; text: string }
      >;
      const userContent: VisionContent = screenshot
        ? [
            {
              type: "image_url" as const,
              // high detail: 차트의 세부 수치까지 정확히 읽기 위해 고해상도 분석 요청
              image_url: { url: screenshot, detail: "high" as const },
            },
            { type: "text" as const, text: userText },
          ]
        : userText;

      const stream = await client.chat.completions.create({
        // 초기 vision 분석: 시각적 차트 해석 품질 우선으로 고성능 모델 사용
        model: VISION_MODEL,
        messages: [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: userContent },
        ],
        stream: true,
        temperature: 0.3,   // 전문 도메인 분석 — 일관성 유지를 위해 낮게 설정
        max_tokens: 1500,   // 시각 분석 포함 → 응답 여유 확보 (텍스트 전용 대비 50% 여유)
      });

      // SSE 스트림 수신: delta를 마지막 assistant 메시지에 누적
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) appendToLastMessage(convKey, delta);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "An unknown error occurred.";
      appendToLastMessage(convKey, `\n\n⚠️ Error: ${errorMsg}`);
    } finally {
      markStreamingComplete(convKey);
    }
  }

  // ============================================================
  // 패널 열릴 때 자동 초기 메시지 전송
  // ============================================================

  useEffect(() => {
    if (
      isPanelOpen &&
      apiKey &&
      messages.length === 0 &&
      !initialSentRef.current
    ) {
      initialSentRef.current = true;
      // vision 버전으로 교체: 화면 캡처 후 분석 요약 자동 시작
      handleSendWithVision(initialMessage);
    }

    // 패널 닫힐 때 플래그 리셋 (재열기 시 초기 메시지 재발송 방지)
    if (!isPanelOpen) {
      initialSentRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPanelOpen, apiKey]);

  // ============================================================
  // 렌더링
  // ============================================================

  return (
    <Sheet open={isPanelOpen} onOpenChange={(open) => !open && closePanel()}>
      <SheetContent
        side="right"
        className="w-[420px] sm:w-[480px] flex flex-col p-0 gap-0"
        showCloseButton={false}
      >
        {/* 패널 헤더: 제목 + 대화 초기화 + API 키 변경 버튼 */}
        <SheetHeader className="flex-row items-center justify-between px-4 py-3 border-b shrink-0">
          <SheetTitle className="text-sm font-semibold">
            {STEP_TITLES[stepNumber]}
          </SheetTitle>
          <div className="flex items-center gap-1">
            {/* API 키 변경 버튼 */}
            {apiKey && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={clearApiKey}
                title="Change API Key"
              >
                <KeyRound className="h-3.5 w-3.5" />
              </Button>
            )}
            {/* 대화 초기화 버튼 */}
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  clearConversation(convKey);
                  initialSentRef.current = false;
                }}
                title="Clear Chat"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            {/* 닫기 버튼 */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={closePanel}
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </SheetHeader>

        {/* 본문: API 키 없으면 입력 화면, 있으면 대화 화면 */}
        {!apiKey ? (
          <ApiKeyInput />
        ) : (
          <>
            {/* 메시지 목록 — 남은 공간 차지 */}
            <MessageList messages={messages} />
            {/* 입력창 — 하단 고정 */}
            <ChatInput onSend={handleSend} isLoading={isStreaming} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
