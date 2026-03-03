import type { NextConfig } from "next";

// 서버사이드 rewrites: Docker 내부망에서는 서비스명(backend:8000) 사용
// 브라우저에서 직접 요청 시는 localhost:8000 사용
const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  // API 요청을 백엔드로 프록시 (CORS 우회, 개발 편의성)
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
  // Next.js 16 Turbopack 사용 - Plotly SSR 이슈는 dynamic import { ssr: false }로 해결
  turbopack: {},
};

export default nextConfig;
