"use client";

import { useEffect, useState } from "react";

// ============================================================
// LabEscMenu — Lab 的 ESC 控制菜单
// - 自包含：内部监听 ESC 切换开/关，遮罩点击关闭（同 GameControlPanel 模式）
// - 功能：导入 PDF / 保存 / 上传 / 丢弃草稿（仅恢复时）/ ← 广场（退出复制）
// - disabled：导入或上传弹窗打开时不响应 ESC（避免遮罩叠遮罩）
// ============================================================

interface LabEscMenuProps {
  empty: boolean;     // 无实体（保存/上传禁用）
  uploading: boolean; // 上传中（上传禁用）
  restored: boolean;  // 草稿已恢复（显示丢弃草稿）
  disabled: boolean;  // 弹窗打开时 ESC 不响应
  onSave: () => void;
  onUpload: () => void;
  onImport: () => void;
  onImportGame: () => void;
  onImportTts: () => void;
  onDraw: () => void;
  onDiscard: () => void;
  onExit: () => void;
}

export default function LabEscMenu({
  empty,
  uploading,
  restored,
  disabled,
  onSave,
  onUpload,
  onImport,
  onImportGame,
  onImportTts,
  onDraw,
  onDiscard,
  onExit,
}: LabEscMenuProps) {
  const [open, setOpen] = useState(false);

  // ESC 呼出 / 关闭（弹窗打开时不响应；INPUT/TEXTAREA 聚焦时不响应）
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled]);

  // 点击按钮：先关菜单再执行（导入/上传会打开弹窗，避免遮罩叠遮罩）
  const closeAnd = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

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
        <p className="text-lg font-bold mb-4">控制菜单</p>

        <div className="flex flex-col gap-2">
          <button className="btn-pop w-full text-sm" onClick={closeAnd(onImport)}>
            导入 PDF
          </button>
          <button className="btn-ghost w-full text-sm" onClick={closeAnd(onImportGame)}>
            导入桌游
          </button>
          <button className="btn-ghost w-full text-sm" onClick={closeAnd(onImportTts)}>
            导入 TTS 图包
          </button>
          <button className="btn-ghost w-full text-sm" onClick={closeAnd(onDraw)}>
            手绘实体
          </button>
          <button className="btn-ghost w-full text-sm" onClick={closeAnd(onSave)} disabled={empty}>
            保存
          </button>
          <button className="btn-pop w-full text-sm" onClick={closeAnd(onUpload)} disabled={empty || uploading}>
            {uploading ? "上传中..." : "上传"}
          </button>
          {restored && (
            <button className="btn-ghost w-full text-sm text-red-500" onClick={closeAnd(onDiscard)}>
              丢弃草稿
            </button>
          )}
          <button className="btn-ghost w-full text-sm text-red-500" onClick={closeAnd(onExit)}>
            ← 广场
          </button>

          <p className="text-[11px] text-muted mt-1">按 ESC 关闭</p>
        </div>
      </div>
    </div>
  );
}
