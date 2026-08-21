"use client";

import { useState } from "react";
import type { Sprite } from "@/lib/engine/types";

// ============================================================
// 实体定义面板（页面预览与图片池之间）— 每张切图定义：
// 形状（矩形/圆形，圆形即时生成透明 PNG）+ 渲染大小（宽高）
// 默认全部矩形 120×168 = 现有卡牌设计，零处理
// ============================================================

interface EntityPanelProps {
  sprites: Sprite[];
  shapes: Map<string, "rect" | "circle">;
  sizes: Map<string, { width: number; height: number }>;
  busyIds: Set<string>; // 圆形处理中的图（禁用）
  onToggleShape: (id: string) => void;
  onBatchShape: (ids: string[], shape: "rect" | "circle") => void;
  onBatchSize: (ids: string[], size: { width: number; height: number }) => void;
  pickerActive: boolean; // 替换/选背面模式下，点图走页面分发（两个面板都生效）
  onSpriteClick: (id: string) => void;
}

export default function EntityPanel({
  sprites, shapes, sizes, busyIds,
  onToggleShape, onBatchShape, onBatchSize, pickerActive, onSpriteClick,
}: EntityPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [w, setW] = useState("");
  const [h, setH] = useState("");

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyShape = (shape: "rect" | "circle") => {
    if (selected.size === 0) return;
    onBatchShape(Array.from(selected), shape);
  };

  const applySize = () => {
    const wv = Math.round(Number(w));
    const hv = Math.round(Number(h));
    if (!wv || !hv || wv <= 0 || hv <= 0 || selected.size === 0) return;
    onBatchSize(Array.from(selected), { width: wv, height: hv });
    // 保留输入值（连续调整不用重输）
  };

  return (
    <div className="border-2 border-ink p-3 mt-3">
      <div className="flex items-center gap-3 mb-2">
        <p className="text-sm font-medium">实体定义（默认矩形 120×168 = 卡牌）</p>
        <button className="link-pop text-[11px]" onClick={() => setSelected(new Set(sprites.map((s) => s.id)))}>
          全选
        </button>
        <button className="link-pop text-[11px]" onClick={() => setSelected(new Set())}>
          全不选
        </button>
        <span className="text-[11px] text-muted">已选 {selected.size}/{sprites.length} 张</span>
      </div>

      <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))" }}>
        {sprites.map((s) => {
          const shape = shapes.get(s.id) ?? "rect";
          const size = sizes.get(s.id);
          const busy = busyIds.has(s.id);
          const isSel = selected.has(s.id);
          return (
            <div
              key={s.id}
              onClick={() => (pickerActive ? onSpriteClick(s.id) : toggle(s.id))}
              className={`relative flex flex-col items-center gap-1 p-1 border-2 bg-card transition-colors cursor-pointer ${isSel ? "border-red-500 ring-2 ring-red-500/30" : "border-ink"} ${busy ? "opacity-50" : ""}`}
            >
              <img src={s.url} alt={s.id} className="w-full h-[88px] object-contain" />
              <span className="text-[10px] font-mono text-secondary">{s.id}</span>
              <span className="text-[10px] text-secondary">{size ? `${size.width}×${size.height}` : "120×168"}</span>
              <button
                className={`absolute top-1 right-1 w-5 h-5 text-[10px] rounded-full border-2 flex items-center justify-center ${shape === "circle" ? "bg-red-500 text-surface border-red-500" : "bg-card border-ink"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleShape(s.id);
                }}
                title={shape === "circle" ? "切换为矩形" : "切换为圆形"}
                disabled={busy}
              >
                {shape === "circle" ? "⚪" : "▢"}
              </button>
            </div>
          );
        })}
      </div>

      {/* 批量工具条 */}
      <div className="flex flex-wrap items-center gap-2 border-t-2 border-ink/40 pt-2 text-xs">
        <span className="text-muted">批量应用到选中：</span>
        <button className="btn-ghost text-[11px]" onClick={() => applyShape("rect")} disabled={selected.size === 0}>
          设为矩形
        </button>
        <button className="btn-ghost text-[11px]" onClick={() => applyShape("circle")} disabled={selected.size === 0}>
          设为圆形
        </button>
        <span className="mx-1 text-muted">|</span>
        <label className="text-[11px] text-secondary flex items-center gap-1">
          宽
          <input type="number" min={1} className="input-pop w-16 px-1.5 py-1" value={w} onChange={(e) => setW(e.target.value)} />
        </label>
        <label className="text-[11px] text-secondary flex items-center gap-1">
          高
          <input type="number" min={1} className="input-pop w-16 px-1.5 py-1" value={h} onChange={(e) => setH(e.target.value)} />
        </label>
        <button className="btn-pop text-[11px]" onClick={applySize} disabled={selected.size === 0}>
          应用尺寸
        </button>
      </div>

      {/* 预览窗口：网格背景（40px = 桌面网格），按实际渲染尺寸展示；选中优先，无选中显示全部 */}
      <div className="mt-2 border-2 border-ink">
        <p className="text-[11px] text-muted px-2 pt-1">
          预览（网格 40px = 桌面；按实际渲染尺寸，默认 120×168）
        </p>
        <div className="board-area p-4 min-h-[160px] max-h-[320px] overflow-auto flex flex-wrap items-start gap-4">
          {(selected.size > 0 ? Array.from(selected) : sprites.map((s) => s.id)).map((id) => {
            const s = sprites.find((x) => x.id === id);
            if (!s) return null;
            const size = sizes.get(id);
            const w = size?.width ?? 120;
            const h = size?.height ?? 168;
            return (
              <img
                key={id}
                src={s.url}
                alt={id}
                title={id}
                style={{ width: w, height: h }}
                className="object-contain bg-card/40"
              />
            );
          })}
          {sprites.length === 0 && <span className="text-xs text-muted">裁剪后显示预览</span>}
        </div>
      </div>
    </div>
  );
}
