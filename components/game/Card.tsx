"use client";

import type { EntityState } from "@/lib/engine";
import { getPrefabFaces, getPrefabSize } from "@/lib/assets/cache";
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
  // 一级查表：prefabId → [正面, 背面]（进房时一次性入缓存）
  // 单面实体：禁用翻面（引擎 flipCard 忽略），faceUp 恒 false → 显式按单面显示正面
  const faces = getPrefabFaces(card.prefabId);
  const singleFace = card.singleFace ?? false;
  const showFront = card.faceUp || singleFace;
  const frontSrc = showFront ? faces?.[0] : undefined;
  const backSrc = card.faceUp ? undefined : faces?.[1];
  const shadowClass = isDragging
    ? "shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
    : "shadow-[0_2px_8px_rgba(0,0,0,0.15)]";
  const transitionClass = isDragging
    ? "transition-shadow duration-150"
    : "transition-[box-shadow,background-color,color] duration-150";

  const cardStyle: React.CSSProperties = {
    width: getPrefabSize(card.prefabId)?.width ?? 120,
    height: getPrefabSize(card.prefabId)?.height ?? 168,
    transform: [isDragging ? "scale(1.05)" : "scale(1)", dragTransform].filter(Boolean).join(" "),
  };

  return (
    <div
      id={card.id}
      data-card-id={card.id}
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`rounded-lg flex items-center justify-center select-none relative overflow-hidden ${frontSrc || backSrc ? "" : faceClass} ${shadowClass} ${transitionClass} ${draggable ? "cursor-grab" : "cursor-default"} ${isHovered ? "ring-2 ring-highlight" : ""}`}
      style={cardStyle}
      {...hoverProps}
    >
      {/* 渲染：正面（faceUp 或单面）→ 背面 → 默认卡背 */}
      {showFront ? (
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
