import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @zmzai/theme 直接发布 src（TS/JSX），需要让 Next 转译它。
  transpilePackages: ["@zmzai/theme"],
};

export default nextConfig;
