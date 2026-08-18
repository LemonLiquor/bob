"use client";

import type { CropConfig } from "@/lib/pnp/crop";

/** 预览图像数据（src + canvas 原始像素） */
export interface PreviewData {
  src: string;
  width: number;   // canvas 原始像素（裁切参数以 canvas 像素为单位）
  height: number;
}

/** 网格预览（格子线按裁剪参数计算，与 cropGrid 布局一致；百分比 → 缩放无关） */
export default function GridPreview({ prev, label, rows, cols, crop }: {
  prev: PreviewData | null;
  label: string;
  rows: number;
  cols: number;
  crop: CropConfig;
}) {
  const pctX = (px: number) => (prev && prev.width > 0 ? (px / prev.width) * 100 : 0);
  const pctY = (px: number) => (prev && prev.height > 0 ? (px / prev.height) * 100 : 0);
  const mt = pctY(crop.marginTop);
  const mb = pctY(crop.marginBottom);
  const ml = pctX(crop.marginLeft);
  const mr = pctX(crop.marginRight);
  const gx = pctX(crop.gapX);
  const gy = pctY(crop.gapY);
  const cellW = (100 - ml - mr - gx * (cols - 1)) / cols;
  const cellH = (100 - mt - mb - gy * (rows - 1)) / rows;

  return (
    <div className="flex-1 min-w-0">
      <p className="text-[11px] text-[#999] mb-1">{label}</p>
      {prev ? (
        <div className="relative border border-[#ddd] rounded overflow-hidden">
          <img src={prev.src} alt={label} className="w-full block" />
          <div className="absolute inset-0 pointer-events-none">
            {Array.from({ length: rows * cols }).map((_, i) => {
              const j = i % cols;
              const r = Math.floor(i / cols);
              return (
                <div
                  key={i}
                  className="absolute border border-red-400/60"
                  style={{
                    left: `${ml + j * (cellW + gx)}%`,
                    top: `${mt + r * (cellH + gy)}%`,
                    width: `${cellW}%`,
                    height: `${cellH}%`,
                  }}
                >
                  <span className="absolute top-0.5 left-1 text-[10px] text-red-500 font-mono bg-white/70 rounded px-0.5">
                    {i + 1}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="border border-dashed border-[#ccc] rounded h-32 flex items-center justify-center text-xs text-[#999]">
          无预览
        </div>
      )}
    </div>
  );
}
