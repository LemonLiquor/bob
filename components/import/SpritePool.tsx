"use client";

import type { Sprite } from "@/lib/engine/types";

// ============================================================
// 图片池 — 全部切图网格，点击切换选中（S3 组卡入口）
// ============================================================

interface SpritePoolProps {
  sprites: Sprite[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

export default function SpritePool({ sprites, selected, onToggle, onSelectAll, onSelectNone }: SpritePoolProps) {
  return (
    <div className="border-2 border-ink p-3">
      <p className="text-sm font-medium mb-2">
        图片池（{sprites.length} 张，选中 {selected.size} 张）
      </p>
      <div className="flex items-center gap-3 mb-2">
        <button className="link-pop text-[11px]" onClick={onSelectAll}>
          全选
        </button>
        <button className="link-pop text-[11px]" onClick={onSelectNone}>
          全不选
        </button>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))" }}>
        {sprites.map((s) => {
          const isSel = selected.has(s.id);
          return (
            <button
              key={s.id}
              onClick={() => onToggle(s.id)}
              className={`relative flex flex-col items-center gap-1 p-1 border-2 bg-card transition-colors ${isSel ? "border-red-500 ring-2 ring-red-500/30" : "border-ink hover:border-secondary"}`}
            >
              <img src={s.url} alt={s.id} className="w-full h-[112px] object-cover" />
              <span className="text-[10px] font-mono text-secondary">{s.id}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
