"use client";

import { useDroppable } from "@dnd-kit/core";
import CardBack from "./CardBack";
import type { Seat } from "@/lib/engine";

/** 其他玩家的手牌区（屏幕顶部折叠条；屏幕 UI 组件，不在桌面坐标系） */
export default function OtherHandBar({ seat }: { seat: Seat }) {
  const { isOver, setNodeRef } = useDroppable({ id: `hand-${seat.id}` });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg px-2.5 py-1.5 flex items-center gap-2 shadow-sm bg-white/85 transition-[border] duration-150 ${
        isOver ? "border-2 border-solid border-[#4a90d9]" : "border border-dashed border-[#ccc]"
      }`}
    >
      <div className="w-6 h-8 rounded-sm overflow-hidden bg-[#1e3a5f] flex items-center justify-center">
        <CardBack />
      </div>
      <div className="text-[11px] leading-tight">
        <p className="text-[#666]">{seat.label}</p>
        <p className="text-[#999]">
          {seat.playerName}
          {seat.handZone.cardIds.length > 0 ? ` · ${seat.handZone.cardIds.length} 张` : ""}
        </p>
      </div>
    </div>
  );
}
