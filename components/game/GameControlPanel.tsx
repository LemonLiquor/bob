"use client";

import { useEffect, useRef, useState } from "react";

// ============================================================
// GameControlPanel — ESC 呼出的控制面板
// - 自包含：内部监听 ESC 切换开/关，遮罩点击关闭
// - 重新开始：仅房主可点（加入玩家灰化）；点击进入确认态（5 秒超时）
// - onExit：多人 = 退出房间；单机 = 返回广场
// ============================================================

interface GameControlPanelProps {
  roomCode?: string;    // 多人房间码
  isCreator?: boolean;  // 多人 restart 权限（false = 灰化）
  onRestart: () => void;
  onExit: () => void;
  exitLabel?: string;
}

export default function GameControlPanel({
  roomCode,
  isCreator = true,
  onRestart,
  onExit,
  exitLabel = "退出",
}: GameControlPanelProps) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ESC 呼出 / 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 卸载时清理确认定时器
  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  function handleRestartClick() {
    if (!isCreator) return;
    if (confirming) {
      setConfirming(false);
      if (confirmTimer.current) {
        clearTimeout(confirmTimer.current);
        confirmTimer.current = null;
      }
      onRestart();
    } else {
      setConfirming(true);
      confirmTimer.current = setTimeout(() => setConfirming(false), 5000);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={() => setOpen(false)}
    >
      <div
        className="panel-pop p-6 min-w-[280px]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-lg font-bold mb-1">控制面板</p>
        {roomCode && <p className="text-sm text-secondary mb-4">房间: {roomCode}</p>}

        <div className="flex flex-col gap-2">
          <button
            className="btn-pop w-full text-sm"
            onClick={handleRestartClick}
            disabled={!isCreator}
          >
            {confirming ? "再次点击确认重新开始" : "重新开始"}
          </button>
          {!isCreator && (
            <p className="text-[11px] text-disabled -mt-1">仅房主可重新开始</p>
          )}

          <button
            className="btn-ghost w-full text-sm text-red-500"
            onClick={onExit}
          >
            {exitLabel}
          </button>

          <p className="text-[11px] text-muted mt-1">按 ESC 关闭</p>
        </div>
      </div>
    </div>
  );
}
