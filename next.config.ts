import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 开发期允许的内网穿透域名访问 dev 资源（HMR 等）；仅 dev 模式生效
  // 域名配在 .env.local 的 DEV_ORIGINS（逗号分隔），不入库
  allowedDevOrigins: (process.env.DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
};

export default nextConfig;
