"use client";

import { useEffect, useRef, useState } from "react";
import { send, onMessage } from "@/lib/multiplayer/transport";
import type { GamePreset } from "@/lib/engine";

// ============================================================
// GameControlPanel — ESC 呼出的控制面板
// - 自包含：内部监听 ESC 切换开/关，遮罩点击关闭
// - 重新开始：仅房主可点（加入玩家灰化）；点击进入确认态（5 秒超时）
// - 预设（presetsEnabled，房间模式）：保存当前桌面 / 加载已存预设，
//   均仅房主；加载带确认态（覆盖桌面）。自包含 ws 订阅
// - onExit：多人 = 退出房间；单机 = 返回广场
// ============================================================

interface GameControlPanelProps {
  roomCode?: string;    // 多人房间码
  isCreator?: boolean;  // 多人 restart / 预设 权限（false = 灰化）
  onRestart: () => void;
  onExit: () => void;
  exitLabel?: string;
  presetsEnabled?: boolean; // 房间模式启用预设区
}

export default function GameControlPanel({
  roomCode,
  isCreator = true,
  onRestart,
  onExit,
  exitLabel = "退出",
  presetsEnabled = false,
}: GameControlPanelProps) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 预设区状态
  const [presets, setPresets] = useState<GamePreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [loadConfirmId, setLoadConfirmId] = useState<string | null>(null);
  const loadConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const deleteConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // 预设列表订阅（mount 时注册，保存后服务端全房广播刷新）
  useEffect(() => {
    if (!presetsEnabled) return;
    const unsub = onMessage((msg) => {
      if (msg.type === "presets_list") setPresets(msg.presets);
    });
    return unsub;
  }, [presetsEnabled]);

  // 面板打开时刷新列表
  useEffect(() => {
    if (open && presetsEnabled) send({ type: "list_presets" });
  }, [open, presetsEnabled]);

  // 卸载时清理确认定时器
  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      if (loadConfirmTimer.current) clearTimeout(loadConfirmTimer.current);
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

  function handleSavePreset() {
    const name = presetName.trim();
    if (!name) return;
    send({ type: "save_preset", name });
    setPresetName("");
  }

  function handleLoadClick(presetId: string) {
    if (!isCreator) return;
    if (loadConfirmId === presetId) {
      setLoadConfirmId(null);
      if (loadConfirmTimer.current) {
        clearTimeout(loadConfirmTimer.current);
        loadConfirmTimer.current = null;
      }
      send({ type: "load_preset", presetId });
    } else {
      setLoadConfirmId(presetId);
      loadConfirmTimer.current = setTimeout(() => setLoadConfirmId(null), 5000);
    }
  }

  function handleDeleteClick(presetId: string) {
    if (!isCreator) return;
    if (deleteConfirmId === presetId) {
      setDeleteConfirmId(null);
      if (deleteConfirmTimer.current) {
        clearTimeout(deleteConfirmTimer.current);
        deleteConfirmTimer.current = null;
      }
      send({ type: "delete_preset", presetId });
    } else {
      setDeleteConfirmId(presetId);
      deleteConfirmTimer.current = setTimeout(() => setDeleteConfirmId(null), 5000);
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

        {presetsEnabled && (
          <div className="mt-4 pt-3 border-t-2 border-ink">
            <p className="text-[10px] text-muted mb-1.5">预设（保存 / 加载桌面摆设）</p>
            <div className="flex gap-1.5">
              <input
                className="input-pop flex-1 min-w-0 text-sm px-2 py-1"
                placeholder="预设名"
                value={presetName}
                maxLength={24}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSavePreset();
                  e.stopPropagation(); // 不触发面板 ESC
                }}
                disabled={!isCreator}
              />
              <button
                className="btn-pop text-xs px-2.5"
                onClick={handleSavePreset}
                disabled={!isCreator || !presetName.trim()}
              >
                保存
              </button>
            </div>
            {presets.length === 0 ? (
              <p className="text-[11px] text-muted mt-2">暂无预设——摆好桌面后输入名字保存</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1 max-h-[160px] overflow-y-auto">
                {presets.map((p) => (
                  <li key={p.id} className="flex gap-1 items-stretch">
                    <button
                      className={`flex-1 min-w-0 text-left text-xs px-2 py-1 border rounded truncate ${loadConfirmId === p.id ? "border-red-500 bg-red-500/10" : "border-ink bg-card hover:bg-secondary/30 active:translate-y-px"}`}
                      onClick={() => handleLoadClick(p.id)}
                      disabled={!isCreator}
                    >
                      {loadConfirmId === p.id ? "再点一次确认加载（覆盖当前桌面）" : `▸ ${p.name}`}
                    </button>
                    <button
                      className={`text-xs px-1.5 border rounded shrink-0 ${deleteConfirmId === p.id ? "border-red-500 bg-red-500/10 text-red-500" : "border-ink bg-card text-muted hover:bg-red-500/10 active:translate-y-px"}`}
                      title="删除预设"
                      onClick={() => handleDeleteClick(p.id)}
                      disabled={!isCreator}
                    >
                      {deleteConfirmId === p.id ? "确认?" : "✕"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!isCreator && (
              <p className="text-[11px] text-disabled mt-1.5">仅房主可保存 / 加载</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
