"use client";

import type { EntityState } from "@/lib/engine";
import { getDieVisual, getPrefabSize } from "@/lib/assets/cache";

// ============================================================
// Die — 骰子/计数器渲染（从 Card 拆出）：
//   有骰面图（TTS 自定义骰）→ faces[v-1] 面图；无图 → ColorDiffuse 着色数字面；
//   label 角标（昵称，如 HP/体力）区分同尺寸骰子
// ============================================================

export default function Die({ card }: { card: EntityState }) {
  const visual = getDieVisual(card.prefabId);
  const v = card.value ?? 1;
  const face = visual?.faceUrls[v - 1];
  const tint = visual?.tint ?? "#ffffff";
  const side = getPrefabSize(card.prefabId)?.width ?? 32;
  const numSize = Math.max(11, Math.min(28, side * 0.42));

  return (
    <div className="relative w-full h-full flex items-center justify-center" style={{ background: face ? undefined : tint }}>
      {face ? (
        <img src={face} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <span className="font-bold" style={{ fontSize: numSize, color: isDark(tint) ? "#f5f5f5" : "#171717" }}>{v}</span>
      )}
      {visual?.label && (
        <span className="absolute bottom-0 inset-x-0 text-center text-[9px] leading-[11px] text-white bg-black/45 truncate">
          {visual.label}
        </span>
      )}
    </div>
  );
}

/** 着色底色亮度 → 数字用深/浅色（TTS ColorDiffuse 深色骰如"体力"需要浅色数字） */
function isDark(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.55;
}
