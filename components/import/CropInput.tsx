"use client";

/** 裁剪参数输入（数字，单位 px = canvas 像素） */
export default function CropInput({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <label className="text-[11px] text-secondary flex items-center gap-1">
      {label}
      <input
        type="number" min={0}
        className="input-pop w-16 px-1.5 py-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
