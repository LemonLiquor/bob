"use client";

import CropInput from "@/components/import/CropInput";
import type { CropConfig } from "@/lib/pnp/crop";

// ============================================================
// 全局切割参数 — 行列 / 页边距 / 牌间隔 + 切割按钮
// ============================================================

interface CropParamsProps {
  rows: number;
  cols: number;
  crop: CropConfig;
  busy: boolean;
  selectedPagesCount: number;
  onGridChange: (kind: "rows" | "cols", value: string) => void;
  onCropChange: (kind: keyof CropConfig, value: string) => void;
  onCrop: () => void;
}

export default function CropParams({ rows, cols, crop, busy, selectedPagesCount, onGridChange, onCropChange, onCrop }: CropParamsProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 mb-3 p-3 border-2 border-ink">
      <label className="text-xs text-secondary flex flex-col gap-1">
        行数
        <input
          type="number" min={1} max={12}
          className="input-pop w-16"
          value={rows}
          onChange={(e) => onGridChange("rows", e.target.value)}
        />
      </label>
      <label className="text-xs text-secondary flex flex-col gap-1">
        列数
        <input
          type="number" min={1} max={12}
          className="input-pop w-16"
          value={cols}
          onChange={(e) => onGridChange("cols", e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[11px] text-muted">页边距</span>
        <CropInput label="上" value={crop.marginTop} onChange={(v) => onCropChange("marginTop", v)} />
        <CropInput label="下" value={crop.marginBottom} onChange={(v) => onCropChange("marginBottom", v)} />
        <CropInput label="左" value={crop.marginLeft} onChange={(v) => onCropChange("marginLeft", v)} />
        <CropInput label="右" value={crop.marginRight} onChange={(v) => onCropChange("marginRight", v)} />
        <span className="text-[11px] text-muted ml-2">牌间隔</span>
        <CropInput label="横" value={crop.gapX} onChange={(v) => onCropChange("gapX", v)} />
        <CropInput label="纵" value={crop.gapY} onChange={(v) => onCropChange("gapY", v)} />
      </div>
      <button
        className="btn-pop text-sm"
        onClick={onCrop}
        disabled={busy || selectedPagesCount === 0}
      >
        {busy ? "切割中..." : `切割勾选页（${selectedPagesCount} 页）`}
      </button>
    </div>
  );
}
