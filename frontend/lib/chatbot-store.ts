/**
 * Zustand 스토어: 챗봇 전역 상태 관리
 *
 * - API 키: localStorage 영속화 (브라우저에만 저장, 서버 미전송)
 * - 패널 열림/닫힘 상태
 * - 대화 기록: convKey(wellId_stepN) 단위로 독립 관리
 *   → 같은 Well의 각 Step은 독립된 대화 스레드를 가짐
 */

import { create } from "zustand";

// ============================================================
// 타입 정의
// ============================================================

export interface ChatMessage {
  /** crypto.randomUUID()로 생성하는 고유 식별자 */
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 스트리밍 진행 중 커서 표시 여부 */
  isStreaming?: boolean;
}

interface ChatbotStore {
  // ── API 키 관리 ──
  apiKey: string | null;
  /** API 키 저장 (localStorage에도 동기화) */
  setApiKey: (key: string) => void;
  /** API 키 삭제 (localStorage에서도 제거) */
  clearApiKey: () => void;

  // ── 패널 열림/닫힘 상태 ──
  isPanelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;

  // ── 대화 기록 (convKey별로 독립 저장) ──
  conversations: Record<string, ChatMessage[]>;
  /** 특정 대화에 메시지 추가 */
  addMessage: (key: string, msg: ChatMessage) => void;
  /**
   * 마지막 assistant 메시지에 스트리밍 델타 추가.
   * OpenAI SSE 스트림의 chunk.choices[0].delta.content를 누적할 때 사용.
   */
  appendToLastMessage: (key: string, delta: string) => void;
  /** 마지막 메시지의 isStreaming 플래그 해제 → 커서 깜빡임 중단 */
  markStreamingComplete: (key: string) => void;
  /** 특정 대화 초기화 */
  clearConversation: (key: string) => void;
}

// localStorage 키 상수 — 오타 방지
const STORAGE_KEY = "chatbot_api_key";

// ============================================================
// 스토어 생성
// ============================================================

export const useChatbotStore = create<ChatbotStore>((set) => ({
  // ── 초기화: SSR 안전 가드로 localStorage에서 API 키 복원 ──
  apiKey:
    typeof window !== "undefined"
      ? localStorage.getItem(STORAGE_KEY)
      : null,

  setApiKey: (key) => {
    // localStorage는 클라이언트에서만 접근 가능
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, key);
    }
    set({ apiKey: key });
  },

  clearApiKey: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
    set({ apiKey: null });
  },

  // ── 패널 상태 ──
  isPanelOpen: false,
  openPanel:  () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false }),

  // ── 대화 기록 ──
  conversations: {},

  addMessage: (key, msg) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [key]: [...(state.conversations[key] ?? []), msg],
      },
    })),

  appendToLastMessage: (key, delta) =>
    set((state) => {
      const msgs = state.conversations[key] ?? [];
      if (msgs.length === 0) return state;

      // 마지막 메시지(assistant 스트리밍 중)에 델타 텍스트 누적
      const last = msgs[msgs.length - 1];
      const updated = {
        ...last,
        content: last.content + delta,
      };

      return {
        conversations: {
          ...state.conversations,
          [key]: [...msgs.slice(0, -1), updated],
        },
      };
    }),

  markStreamingComplete: (key) =>
    set((state) => {
      const msgs = state.conversations[key] ?? [];
      if (msgs.length === 0) return state;

      const last = msgs[msgs.length - 1];
      const updated = { ...last, isStreaming: false };

      return {
        conversations: {
          ...state.conversations,
          [key]: [...msgs.slice(0, -1), updated],
        },
      };
    }),

  clearConversation: (key) =>
    set((state) => {
      const next = { ...state.conversations };
      delete next[key];
      return { conversations: next };
    }),
}));
