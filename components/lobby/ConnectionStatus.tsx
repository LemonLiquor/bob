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

  const dotClass =
    wsStatus === "connected" ? "status-dot ok" :
    wsStatus === "reconnecting" ? "status-dot warn" :
    "status-dot err";

  const label =
    wsStatus === "connected" ? "已连接" :
    wsStatus === "reconnecting" ? "重连中..." :
    "未连接";

  return (
    <div className="fixed top-2 right-3 flex items-center gap-1.5 z-50">
      <span className={`${dotClass}`} />
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  );
}
