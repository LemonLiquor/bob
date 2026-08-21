"use client";

import Link from "next/link";
import type { GameAssets, GameState } from "@/lib/engine/types";
import type { UploadGameMeta } from "@/lib/multiplayer/protocol";

// ============================================================
// 生成区 — 桌游名 + 生成按钮 + 上传前 JSON 预览
// ============================================================

/** 待上传桌游包（meta + assets + 无座 initialState） */
export interface PendingUpload {
  meta: UploadGameMeta;
  assets: GameAssets;
  initialState: GameState;
}

/** 验收打印/页面展示：url 截断摘要，避免 dataURL 刷屏 */
function jsonPreview(payload: PendingUpload) {
  return {
    meta: payload.meta,
    assets: {
      sprites: payload.assets.sprites.map((s) => ({ id: s.id, url: s.url.slice(0, 60) + `…(${s.url.length})` })),
      prefabs: payload.assets.prefabs,
    },
    initialState: payload.initialState,
  };
}

interface GeneratePanelProps {
  name: string;
  onNameChange: (v: string) => void;
  canGenerate: boolean;
  onGenerate: () => void;
  pendingUpload: PendingUpload | null;
}

export default function GeneratePanel({ name, onNameChange, canGenerate, onGenerate, pendingUpload }: GeneratePanelProps) {
  return (
    <>
      <div className="flex items-end justify-end gap-2 mt-4">
        <Link href="/games" className="btn-ghost text-sm">
          取消
        </Link>
        <label className="text-xs text-secondary flex flex-col gap-1">
          桌游名
          <input
            className="input-pop w-48"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="我的桌游"
          />
        </label>
        <button
          className="btn-pop text-sm"
          onClick={onGenerate}
          disabled={!canGenerate}
        >
          生成桌游数据
        </button>
      </div>

      {pendingUpload && (
        <div className="mt-4 border-2 border-ink p-3 bg-card">
          <p className="text-sm font-medium mb-2">桌游数据（上传前检查；坐标可在 Lab 中调整）</p>
          <pre className="text-[11px] font-mono text-secondary max-h-64 overflow-auto whitespace-pre-wrap break-all">
            {JSON.stringify(jsonPreview(pendingUpload), null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}
