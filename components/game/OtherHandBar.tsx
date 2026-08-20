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
      className={`dashed-zone rounded-lg px-2.5 py-1.5 flex items-center gap-2 shadow-sm bg-card/85 transition-[border,background] duration-150 ${
        isOver ? "dashed-zone-over" : ""
      }`}
    >
      <div className="w-6 h-8 rounded-sm overflow-hidden bg-[#1e3a5f] flex items-center justify-center">
        <CardBack />
      </div>
      <div className="text-[11px] leading-tight">
        <p className="text-secondary">{seat.label}</p>
        <p className="text-muted">
          {seat.playerName}
          {seat.handZone.entityIds.length > 0 ? ` · ${seat.handZone.entityIds.length} 张` : ""}
        </p>
      </div>
    </div>
  );
}
