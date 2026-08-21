"use client";

import type { EntityState } from "@/lib/engine";
import { getPrefabFaces, getPrefabSingleFace } from "@/lib/assets/cache";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useHoverable } from "@/lib/engine/card-action";
import CardBack from "./CardBack";

interface CardProps {
  card: EntityState;
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
  // 一级查表：prefabId → [正面, 背面]（进房时一次性入缓存），faceUp 决定取哪个面
  // 单面实体：永远显示正面（F 翻面无效果）
  const faces = getPrefabFaces(card.prefabId);
  const singleFace = getPrefabSingleFace(card.prefabId);
  const frontSrc = singleFace || card.faceUp ? faces?.[0] : undefined;
  const backSrc = singleFace ? undefined : card.faceUp ? undefined : faces?.[1];
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
      className={`w-[120px] h-[168px] rounded-lg flex items-center justify-center select-none relative overflow-hidden ${faceClass} ${shadowClass} ${transitionClass} ${draggable ? "cursor-grab" : "cursor-default"} ${isHovered ? "ring-2 ring-highlight" : ""}`}
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
