"use client";

import { CardState } from "@/lib/engine";
import { getCardAsset } from "@/lib/assets/cache";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useHoverable } from "@/lib/engine/card-action";
import CardBack from "./CardBack";

interface CardProps {
  card: CardState;
  children?: React.ReactNode;
  draggable?: boolean;
}

export default function Card({ card, children, draggable = false }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    disabled: !draggable,
  });

  const dragTransform = CSS.Translate.toString(transform);

  const { isHovered, hoverProps } = useHoverable({ id: card.id });

  const faceClass = card.faceUp ? "bg-white text-black" : "bg-[#1e3a5f] text-white";
  // 一级查表：card.id → 资产（进房时一次性入内存缓存），faceUp 决定正/背
  const asset = getCardAsset(card.id);
  const frontSrc = card.faceUp ? asset?.frontUrl : undefined;
  const backSrc = card.faceUp ? undefined : asset?.backUrl;
  const shadowClass = isDragging
    ? "shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
    : "shadow-[0_2px_8px_rgba(0,0,0,0.15)]";
  const transitionClass = isDragging
    ? "transition-shadow duration-150"
    : "transition-[box-shadow,background-color,color] duration-150";

  const cardStyle: React.CSSProperties = {
    transform: [isDragging ? "scale(1.05)" : "scale(1)", dragTransform].filter(Boolean).join(" "),
  };

  return (
    <div
      id={card.id}
      data-card-id={card.id}
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`w-[120px] h-[168px] rounded-lg flex items-center justify-center select-none relative overflow-hidden ${faceClass} ${shadowClass} ${transitionClass} ${draggable ? "cursor-grab" : "cursor-default"} ${isHovered ? "ring-2 ring-blue-400" : ""}`}
      style={cardStyle}
      {...hoverProps}
    >
      {card.faceUp ? (
        frontSrc ? (
          <img src={frontSrc} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="text-[32px]">{children}</div>
        )
      ) : backSrc ? (
        <img src={backSrc} alt="" className="w-full h-full object-cover" />
      ) : (
        <CardBack />
      )}
    </div>
  );
}
