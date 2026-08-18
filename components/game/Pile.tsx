"use client";

import { useEffect, useState } from "react";
import type { Pile as PileType, CardState } from "@/lib/engine";
import { useDroppable } from "@dnd-kit/core";
import { stackLayout } from "@/lib/engine/layout";
import Card from "./Card";

interface PileProps {
  pile: PileType;
  cards: CardState[];  // 按从下到上顺序
  onShuffle: (pileId: string) => void;
}

export default function Pile({ pile, cards, onShuffle }: PileProps) {
  const { isOver, setNodeRef } = useDroppable({ id: pile.id });
  const [isHovered, setIsHovered] = useState(false);

  const count = cards.length;
  const offsets = stackLayout(count);

  // hover 牌堆时监听 R（洗牌）。
  // D（抓牌）由 CardActionProvider 统一处理：hover 时 active 即顶牌，
  // handleDraw(顶牌 id) 走 move_to_hand，等价于从顶部抓，避免双监听重复发动作
  useEffect(() => {
    if (!isHovered) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const lower = e.key.toLowerCase();
      if (lower === "r") onShuffle(pile.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isHovered, pile.id, onShuffle]);

  const overClass = isOver
    ? "dashed-zone-over"
    : "dashed-zone";

  const containerClass = `absolute rounded-lg transition-[border,background] duration-150 ${overClass} ${isHovered ? "ring-2 ring-highlight" : ""}`;

  const containerStyle: React.CSSProperties = {
    left: pile.x,
    top: pile.y,
    width: 120,
    height: 168,
  };

  return (
    <div
      ref={setNodeRef}
      className={containerClass}
      style={containerStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 堆叠的牌：只有顶部可拖 */}
      {cards.map((card, i) => (
        <div
          key={card.id}
          style={{
            position: "absolute",
            left: offsets[i].offsetX,
            top: offsets[i].offsetY,
          }}
        >
          <Card card={card} draggable={i === count - 1} />
        </div>
      ))}

      {/* 张数角标 */}
      <div className="absolute -top-2 -right-2 min-w-[22px] h-[22px] px-1 rounded-full bg-ink text-surface text-[11px] flex items-center justify-center shadow">
        {count}
      </div>

      {/* hover 提示：洗牌 */}
      {isHovered && count > 1 && (
        <button
          className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[11px] text-muted hover:text-ink bg-card/90 rounded px-1.5 py-0.5 shadow cursor-pointer whitespace-nowrap"
          onClick={(e) => {
            e.stopPropagation();
            onShuffle(pile.id);
          }}
          title="洗牌（或 hover 按 R）"
        >
          [洗牌 R]
        </button>
      )}
    </div>
  );
}
