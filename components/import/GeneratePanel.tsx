"use client";

// ============================================================
// 生成区 — 弹窗底部操作条（取消 / 导入）
// 桌游名不在 ImportFlow 设置（ImportFlow 对应 PDF，名称取文件名；
// 桌游名在 lab 上传弹窗设置）。
// ============================================================

interface GeneratePanelProps {
  canImport: boolean;
  onImport: () => void;
  onCancel: () => void;
}

export default function GeneratePanel({ canImport, onImport, onCancel }: GeneratePanelProps) {
  return (
    <div className="flex items-center justify-end gap-2 mt-4">
      <button className="btn-ghost text-sm" onClick={onCancel}>
        取消
      </button>
      <button className="btn-pop text-sm" onClick={onImport} disabled={!canImport}>
        导入
      </button>
    </div>
  );
}
