"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getStatus, onStatusChange } from "@/lib/multiplayer/connection";
import ThemeSwitch from "@/components/layout/ThemeSwitch";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  // WS 连接由根布局的 <WsConnection> 管理，这里只订阅状态做 UI 指示
  const [wsStatus, setWsStatus] = useState(getStatus());

  useEffect(() => {
    const unsub = onStatusChange(setWsStatus);
    return () => {
      unsub();
    };
  }, []);

  const dotClass =
    wsStatus === "connected" ? "status-dot ok" :
    wsStatus === "reconnecting" ? "status-dot warn" :
    "status-dot err";

  return (
    <>
      <nav className="nav-shell fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-6">
        <Link href="/games" className="flex items-center gap-3 font-bold text-lg tracking-tight cursor-pointer">
          <span className="logo-shape" />
          Box of Boardgames
        </Link>
        <div className="flex items-center gap-3">
          <ThemeSwitch />
          <span className={`${dotClass}`} />
          <span className="text-[11px] text-secondary">
            {wsStatus === "connected" ? "已连接" : wsStatus === "reconnecting" ? "重连中..." : "未连接"}
          </span>
        </div>
      </nav>
      <div className="pt-14">{children}</div>
    </>
  );
}
