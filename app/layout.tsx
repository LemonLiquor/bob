import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import WsConnection from "@/components/lobby/WsConnection";
import GeoBg from "@/components/layout/GeoBg";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Box of Boardgames",
  description: "桌游沙盒",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className={`${spaceGrotesk.className} relative`}>
        {/* WS 连接生命周期挂载在根布局（app 存活期间不中断，跨路由 group 不重连） */}
        <WsConnection />
        <GeoBg />
        <div className="relative z-[1]">{children}</div>
      </body>
    </html>
  );
}
