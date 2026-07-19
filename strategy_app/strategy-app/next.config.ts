import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // socket.io-client（計時サーバー購読用）はサーバー関数側で require し、
  // バンドルに取り込ませない（ws などの依存で不具合を避ける）。
  serverExternalPackages: ["socket.io-client"],
};

export default nextConfig;
