import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 브라우저 자동화 라이브러리는 번들하지 않고 node_modules에서 그대로 불러옴
  serverExternalPackages: ["playwright-core"],
};

export default nextConfig;
