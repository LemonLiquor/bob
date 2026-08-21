"use client";

import { useEffect, useState } from "react";
import type { Pile as PileType, EntityState } from "@/lib/engine";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { stackLayout } from "@/lib/engine/layout";
import Card from "./Card";

interface PileProps {
  pile: PileType;
  cards: EntityState[];  // 按从下到上顺序
  onShuffle: (pileId: string) => void;
  shiftHeld: boolean; // Shift 按住 → 顶牌禁拖，整堆 draggable 接管（整体移动）
}

export default function Pile({ pile, cards, onShuffle, shiftHeld }: PileProps) {
  // 容器同时是 droppable（牌拖入堆）与 draggable（整堆移动）：
  // - 非 Shift 拖顶牌 → 顶牌 draggable 激活（单牌）
  // - Shift 按住 → 顶牌 disabled → sensor 向上找到容器 → 整堆
  // - 拖下层牌偏移区 → 无 draggable → 容器 → 整堆（TTS 式）
  const { isOver, setNodeRef: setDropNodeRef } = useDroppable({ id: pile.id });
  const { setNodeRef: setDragNodeRef, transform, isDragging: isPileDragging, listeners } = useDraggable({
    id: `pile-move-${pile.id}`,
  });
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

  // hover / 拖拽悬停：黑虚线框变红（不叠加 ring / 实线框）
  const overClass = isOver || isHovered ? "dashed-zone-active" : "dashed-zone";

  const containerClass = `absolute rounded-lg transition-[border,background] duration-150 ${overClass} ${isPileDragging ? "shadow-[0_8px_24px_rgba(0,0,0,0.25)]" : ""}`;

  // draggable + droppable 共用一个节点；listeners/attributes 只挂 [移动] 把手（handle 模式）
  const setRefs = (el: HTMLDivElement | null) => {
    setDropNodeRef(el);
    setDragNodeRef(el);
  };

  const containerStyle: React.CSSProperties = {
    left: pile.x,
    top: pile.y,
    width: 120,
    height: 168,
    transform: CSS.Translate.toString(transform),
  };

  return (
    <div
      id={`pile-${pile.id}`}
      ref={setRefs}
      {...listeners}
      className={`${containerClass}`}
      style={containerStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 堆叠的牌：只有顶部可拖（Shift 按住时顶牌禁拖，交给容器整堆） */}
      {cards.map((card, i) => (
        <div
          key={card.id}
          style={{
            position: "absolute",
            left: offsets[i].offsetX,
            top: offsets[i].offsetY,
          }}
        >
          <Card card={card} draggable={i === count - 1 && !shiftHeld} />
        </div>
      ))}

      {/* hover 顶部提示（左对齐，底边贴在容器顶框上方 4px，新增行自动向上扩展）：整体移动 + 洗牌 */}
      {isHovered && count > 1 && (
        <div className="absolute left-0 bottom-[calc(100%+4px)] flex flex-col items-start gap-0.5 pointer-events-none">
          <span className="text-[11px] text-muted bg-card/90 rounded px-1.5 py-0.5 shadow whitespace-nowrap">
            Shift+拖 移动整堆
          </span>
          <span className="text-[11px] text-muted bg-card/90 rounded px-1.5 py-0.5 shadow whitespace-nowrap">
            R 洗牌
          </span>
        </div>
      )}

      {/* 张数角标 */}
      <div className="absolute -top-2 -right-2 min-w-[22px] h-[22px] px-1 rounded-full bg-ink text-surface text-[11px] flex items-center justify-center shadow">
        {count}
      </div>

    </div>
  );
}
