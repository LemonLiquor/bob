"use client";

import { useEffect } from "react";
import { connect, disconnect } from "@/lib/multiplayer/connection";

// WS 连接生命周期挂载在根布局（整个 app 只连接一次）。
// 不能放在 (main)/layout.tsx：路由从 (main) 切到 (game) group 时 layout 卸载
// 会触发 disconnect()，导致游戏页面 WS 断开。
export default function WsConnection() {
  useEffect(() => {
    connect();
    return () => disconnect();
  }, []);
  return null;
}
