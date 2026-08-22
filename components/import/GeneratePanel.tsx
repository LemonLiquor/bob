"use client";

import type { GameAssets, GameState } from "@/lib/engine/types";
import type { UploadGameMeta } from "@/lib/multiplayer/protocol";

// ============================================================
// 生成区 — 桌游名 + 导入按钮（弹窗底部操作条）
// 切片 2：取消改 onCancel（关闭弹窗回工作台），生成改 [导入]
// ============================================================

/** 待上传桌游包（meta + assets + 无座 initialState） */
export interface PendingUpload {
  meta: UploadGameMeta;
  assets: GameAssets;
  initialState: GameState;
}

interface GeneratePanelProps {
  name: string;
  onNameChange: (v: string) => void;
  canImport: boolean;
  onImport: () => void;
  onCancel: () => void;
}

export default function GeneratePanel({ name, onNameChange, canImport, onImport, onCancel }: GeneratePanelProps) {
  return (
    <div className="flex items-end justify-end gap-2 mt-4">
      <label className="text-xs text-secondary flex flex-col gap-1">
        桌游名
        <input
          className="input-pop w-48"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="我的桌游"
        />
      </label>
      <button className="btn-ghost text-sm" onClick={onCancel}>
        取消
      </button>
      <button className="btn-pop text-sm" onClick={onImport} disabled={!canImport}>
        导入
      </button>
    </div>
  );
}
