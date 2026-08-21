"use client";

import Link from "next/link";
import type { GameAssets, GameState } from "@/lib/engine/types";
import type { UploadGameMeta } from "@/lib/multiplayer/protocol";

// ============================================================
// 生成区 — 桌游名 + 生成桌游（生成并进入 Lab）
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
  canGenerate: boolean;
  onGenerate: () => void;
}

export default function GeneratePanel({ name, onNameChange, canGenerate, onGenerate }: GeneratePanelProps) {
  return (
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
        生成桌游
      </button>
    </div>
  );
}
