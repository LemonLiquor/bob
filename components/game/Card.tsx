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
  // kind 决定面选择：token/board 单面恒正面（禁翻）；card 按 faceUp
  const faces = getPrefabFaces(card.prefabId);
  const showFront = card.kind !== "card" || card.faceUp;
  const frontSrc = showFront ? faces?.[0] : undefined;
  const backSrc = card.faceUp ? undefined : faces?.[1];
  const shadowClass = isDragging
    ? "shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
    : "shadow-[0_2px_8px_rgba(0,0,0,0.15)]";
  const transitionClass = isDragging
    ? "transition-shadow duration-150"
    : "transition-[box-shadow,background-color,color] duration-150";

  // 版图渲染：size 保持原始；有效尺寸（容器）按 rotation 分支——90/270 宽高互换，
  // 图保持原始方向居中 + rotate，旋转后恰好填满容器。视觉包围盒 = 有效尺寸 = 引擎坐标，拖拽零换算。
  const base = getPrefabSize(card.prefabId) ?? { width: 120, height: 168 };
  const boardRotated = card.kind === "board" && (card.rotation === 90 || card.rotation === 270);
  const cw = boardRotated ? base.height : base.width;
  const ch = boardRotated ? base.width : base.height;
  const imgW = boardRotated ? ch : cw; // = base.width（原始方向）
  const imgH = boardRotated ? cw : ch; // = base.height

  const cardStyle: React.CSSProperties = {
    width: cw,
    height: ch,
    // 版图旋转不转容器（容器 = 有效尺寸）；图在容器内居中旋转
    transform: [isDragging ? "scale(1.05)" : "scale(1)", dragTransform].filter(Boolean).join(" "),
  };
  const rotStyle: React.CSSProperties = {
    width: imgW,
    height: imgH,
    left: boardRotated ? (cw - imgW) / 2 : 0,
    top: boardRotated ? (ch - imgH) / 2 : 0,
    transform: card.rotation ? `rotate(${card.rotation}deg)` : undefined,
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
      {/* 渲染：版图（图居中旋转，填满容器）→ 正面（token 恒正面 / faceUp）→ 背面 → 默认卡背 */}
      {card.kind === "board" && frontSrc ? (
        <img
          src={frontSrc}
          alt=""
          className="absolute object-contain"
          style={rotStyle}
        />
      ) : showFront ? (
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
