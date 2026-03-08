import type { NextConfig } from "next";

// Server-side rewrites: use the service name (backend:8000) inside the Docker network.
// Use localhost:8000 when requests come directly from the browser.
const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  // Proxy API requests to the backend (bypasses CORS, improves DX)
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
  // Use Next.js 16 Turbopack – Plotly SSR issues are resolved via dynamic import { ssr: false }
  turbopack: {},
};

export default nextConfig;
