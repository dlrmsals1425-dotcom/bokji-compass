import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // 로컬 빌드의 페이지 수집·정적 생성 작업자가 메모리를 과점유하지 않도록 제한
  experimental: { cpus: 2 },
  // /workspace 상위의 package-lock.json 을 루트로 오인하지 않도록 고정
  turbopack: { root: path.resolve(__dirname) },
  async headers() {
    return [
      {
        // 번들은 데이터 버전(v1) 단위로 교체 — 짧게 캐시하고 재검증
        source: "/bundles/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=600, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default nextConfig;
