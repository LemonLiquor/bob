import type { Metadata } from "next";
import "./globals.css";
import WsConnection from "@/components/lobby/WsConnection";

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
      <body>
        {/* WS 连接生命周期挂载在根布局（app 存活期间不中断，跨路由 group 不重连） */}
        <WsConnection />
        {children}
      </body>
    </html>
  );
}
