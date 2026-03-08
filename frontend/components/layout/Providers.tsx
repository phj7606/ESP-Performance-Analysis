"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";

/**
 * Client-side Provider wrapper.
 * - TanStack Query: server state management + caching
 * - Toaster: global notifications (sonner)
 *
 * Separated into its own component because it requires the 'use client' directive.
 * Imported and used in layout.tsx.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  // One QueryClient per component instance (prevents recreation on re-render)
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
      {/* Query state visualiser – visible in development only */}
      <ReactQueryDevtools initialIsOpen={false} />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
