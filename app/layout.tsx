import type { Metadata, Viewport } from "next";

import "./globals.css";

// 中文主字体 MiSans 走 jsDelivr CDN @font-face（globals.css），不用 next/font 加载 CJK。
export const metadata: Metadata = {
  title: "Data · zmzai.cloud",
  description: "统一行情服务（A股 + 加密 日线/报价）· zmzai.cloud 子产品",
};

export const viewport: Viewport = { themeColor: "#FFFFFF" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
