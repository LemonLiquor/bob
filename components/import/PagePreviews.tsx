"use client";

import GridPreview, { type PreviewData } from "@/components/import/GridPreview";
import type { CropConfig } from "@/lib/pnp/crop";

// ============================================================
// 页面预览 — 只显示勾选页，格子线按当前参数实时计算
// ============================================================

interface PagePreviewsProps {
  previews: (PreviewData | null)[];
  selectedPages: Set<number>;
  pageCount: number;
  rows: number;
  cols: number;
  crop: CropConfig;
}

export default function PagePreviews({ previews, selectedPages, pageCount, rows, cols, crop }: PagePreviewsProps) {
  return (
    <div className="mb-3 p-3 border-2 border-ink">
      <p className="text-sm font-medium mb-2">页面预览（{selectedPages.size}/{pageCount} 页，调参实时对齐格子线）</p>
      <div className="flex flex-wrap gap-4">
        {previews.map((p, i) => {
          const page = i + 1;
          if (!selectedPages.has(page)) return null;
          return (
            <div key={i} className="w-[240px]">
              <GridPreview prev={p} label={`第 ${page} 页`} rows={rows} cols={cols} crop={crop} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
