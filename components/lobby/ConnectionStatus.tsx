"use client";

import { useState, useEffect } from "react";
import { connect, disconnect, getStatus, onStatusChange } from "@/lib/multiplayer/connection";

// ============================================================
// ConnectionStatus — WS 连接状态指示器（挂载在根布局）
// ============================================================

export default function ConnectionStatus() {
  const [wsStatus, setWsStatus] = useState(getStatus());

  useEffect(() => {
    connect();
    const unsub = onStatusChange(setWsStatus);
    return () => {
      unsub();
      disconnect();
    };
  }, []);

  const dotColor =
    wsStatus === "connected" ? "bg-green-500" :
    wsStatus === "reconnecting" ? "bg-yellow-500" :
    "bg-red-500";

  const label =
    wsStatus === "connected" ? "已连接" :
    wsStatus === "reconnecting" ? "重连中..." :
    "未连接";

  return (
    <div className="fixed top-2 right-3 flex items-center gap-1.5 z-50">
      <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
      <span className="text-[11px] text-[#999]">{label}</span>
    </div>
  );
}
