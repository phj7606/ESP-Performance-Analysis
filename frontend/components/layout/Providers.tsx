"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";

/**
 * 클라이언트 사이드 Provider 래퍼.
 * - TanStack Query: 서버 상태 관리 + 캐싱
 * - Toaster: 전역 알림 (sonner)
 *
 * 'use client' 지시어가 필요하므로 별도 컴포넌트로 분리.
 * layout.tsx에서 import하여 사용.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  // 컴포넌트 인스턴스당 1개의 QueryClient (리렌더링 시 재생성 방지)
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 10_000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* 개발 환경에서만 쿼리 상태 시각화 도구 표시 */}
      <ReactQueryDevtools initialIsOpen={false} />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
