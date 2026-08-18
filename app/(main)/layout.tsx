"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getStatus, onStatusChange } from "@/lib/multiplayer/connection";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  // WS 连接由根布局的 <WsConnection> 管理，这里只订阅状态做 UI 指示
  const [wsStatus, setWsStatus] = useState(getStatus());

  useEffect(() => {
    const unsub = onStatusChange(setWsStatus);
    return () => {
      unsub();
    };
  }, []);

  const dotColor =
    wsStatus === "connected" ? "bg-green-500" :
    wsStatus === "reconnecting" ? "bg-yellow-500" :
    "bg-red-500";

  return (
    <>
      <nav className="bg-white border-b border-[#eee] h-12 flex items-center justify-between px-4">
        <Link href="/games" className="text-lg font-bold cursor-pointer">
          ♟️ Box of Boardgames
        </Link>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
          <span className="text-[11px] text-[#999]">
            {wsStatus === "connected" ? "已连接" : wsStatus === "reconnecting" ? "重连中..." : "未连接"}
          </span>
        </div>
      </nav>
      {children}
    </>
  );
}
