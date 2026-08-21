"use client";

// ============================================================
// 页面多选 — 勾选参与切割的页（纯展示，回调上抛）
// ============================================================

interface PagePickerProps {
  pageCount: number;
  selectedPages: Set<number>;
  onTogglePage: (page: number) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

export default function PagePicker({ pageCount, selectedPages, onTogglePage, onSelectAll, onSelectNone }: PagePickerProps) {
  return (
    <div className="mb-3 p-3 border-2 border-ink">
      <div className="flex items-center gap-3 mb-2">
        <p className="text-sm font-medium">页面选择</p>
        <button className="link-pop text-[11px]" onClick={onSelectAll}>
          全选
        </button>
        <button className="link-pop text-[11px]" onClick={onSelectNone}>
          全不选
        </button>
        <span className="text-[11px] text-muted">已选 {selectedPages.size}/{pageCount} 页，仅勾选页参与切割</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: pageCount }).map((_, i) => {
          const page = i + 1;
          const checked = selectedPages.has(page);
          return (
            <label
              key={page}
              className={`flex items-center gap-1 text-xs cursor-pointer border-2 px-2 py-1 select-none transition-colors ${checked ? "border-red-500 bg-card" : "border-ink opacity-60 hover:opacity-100"}`}
            >
              <input type="checkbox" checked={checked} onChange={() => onTogglePage(page)} className="accent-red-500" />
              第 {page} 页
            </label>
          );
        })}
      </div>
    </div>
  );
}
