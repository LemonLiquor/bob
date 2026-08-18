"use client";

import { useDroppable } from "@dnd-kit/core";
import { SPREAD_GAP } from "@/lib/engine";
import Card from "./Card";
import type { CardState, Seat } from "@/lib/engine";

/** 我的手牌区（屏幕底部 spread 展开；屏幕 UI 组件，不在桌面坐标系） */
export default function HandZone({ seat, cards }: { seat: Seat; cards: CardState[] }) {
  const { isOver, setNodeRef } = useDroppable({ id: `hand-${seat.id}` });

  return (
    <div
      ref={setNodeRef}
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg p-2 min-h-[184px] flex items-end transition-[border,background] duration-150 z-40 ${
        isOver
          ? "border-2 border-solid border-[#4a90d9] bg-[rgba(74,144,217,0.06)]"
          : "border border-dashed border-[#ccc] bg-transparent"
      }`}
      style={{ gap: SPREAD_GAP }}
    >
      {cards.map((card) => (
        <div key={card.id}>
          <Card card={card} draggable />
        </div>
      ))}
      {cards.length === 0 && (
        <span className="text-[11px] text-[#999] px-2 select-none">我的手牌区 [D 抓牌]</span>
      )}
    </div>
  );
}
