"use client";

import { useEffect, useState } from "react";
import type { Pile as PileType, EntityState } from "@/lib/engine";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { stackLayout } from "@/lib/engine/layout";
import { getPrefabFaces, getPrefabSize } from "@/lib/assets/cache";
import Card from "./Card";

interface PileProps {
  pile: PileType;
  cards: EntityState[];  // 按从下到上顺序
  onShuffle: (pileId: string) => void;
  onFlipPile?: (pileId: string) => void; // 翻整叠（hover + Shift+F）
  shiftHeld: boolean; // Shift 按住 → 顶牌禁拖，整堆 draggable 接管（整体移动）
  zoom?: number; // 所在容器缩放倍数：拖拽位移（视口）÷zoom 使视觉跟手
}

export default function Pile({ pile, cards, onShuffle, onFlipPile, shiftHeld, zoom = 1 }: PileProps) {
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
  const visibleCount = Math.min(count, PILE_EDGE_COUNT + 1);
  // 偏移本地化：可见卡簇锚定堆基座（第 k 张渲染在 k*0.5px），不照搬 stackLayout 的全堆累加偏移
  // ——否则大堆只渲染顶部几张时，整簇悬空在基座右下方（性能切片回归，已修）
  const offsets = stackLayout(visibleCount);

  // 容器尺寸跟随堆内实体（缺省 120×168 卡牌）
  const first = cards[0];
  const pw = first?.size?.width ?? 120;
  const ph = first?.size?.height ?? 168;

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
      // 翻整叠：Shift+F（无 Shift 的 F = 翻顶牌，由 CardActionProvider 处理）
      if (e.shiftKey && lower === "f") onFlipPile?.(pile.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isHovered, pile.id, onShuffle, onFlipPile]);

  // 空堆不渲染（不挂 droppable 节点）：旧存档可能带空堆（构建期已不再产出），
  // 渲染成虚线框会劫持拖放落点，而引擎判定跳过空堆 → 表现为"堆叠失效"。
  // 置于全部 hooks 之后（Rules of Hooks）
  if (count === 0) return null;

  // hover / 拖拽悬停：黑虚线框变红（不叠加 ring / 实线框）
  const overClass = isOver || isHovered ? "dashed-zone-active" : "dashed-zone";

  const containerClass = `absolute rounded-lg transition-[border,background] duration-150 ${overClass} ${isPileDragging ? "shadow-[0_8px_24px_rgba(0,0,0,0.25)]" : ""}`;

  // draggable + droppable 共用一个节点；listeners/attributes 只挂 [移动] 把手（handle 模式）
  const setRefs = (el: HTMLDivElement | null) => {
    setDropNodeRef(el);
    setDragNodeRef(el);
  };

  // 拖拽位移（视口坐标）应用在缩放容器内 → 除以 zoom 抵消容器放大，视觉位移 = 鼠标位移
  const dragTransform = transform
    ? CSS.Translate.toString({
        x: transform.x / zoom,
        y: transform.y / zoom,
        scaleX: transform.scaleX,
        scaleY: transform.scaleY,
      })
    : "";

  // 定位与层级由 GameBoard 的拍平 wrapper 承担（世界坐标 + 全局 zIndex）；容器只负责堆内布局
  const containerStyle: React.CSSProperties = {
    left: 0,
    top: 0,
    width: pw,
    height: ph,
    transform: dragTransform,
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
      {/* 堆叠视觉：顶牌 = 完整 Card（可拖 + 快捷键载体）；顶牌之下最多 3 张降级为纯 div/img
          （无 hooks，性能切片 M2），更深的成员不渲染——0.5px 阶梯在亚像素级，且张数角标已示数。
          状态保留全部成员，洗牌/翻整叠/抓牌语义不变 */}
      {cards.slice(count - visibleCount, count - 1).map((card, k) => (
        <PileEdge key={card.id} card={card} offset={offsets[k]} />
      ))}
      {cards[count - 1] && (
        <div
          style={{
            position: "absolute",
            left: offsets[visibleCount - 1].offsetX,
            top: offsets[visibleCount - 1].offsetY,
          }}
        >
          <Card card={cards[count - 1]} draggable={!shiftHeld} zoom={zoom} />
        </div>
      )}

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

/** 顶牌之下最多渲染几张降级边缘（纯 div/img） */
const PILE_EDGE_COUNT = 3;

/** 堆内下层牌的降级渲染：视觉对齐 Card（尺寸/圆角/阴影/面图），但不挂任何 hooks、
 *  不带 data-card-id（埋牌不再响应 hover 快捷键——交互语义收敛到顶牌） */
function PileEdge({ card, offset }: { card: EntityState; offset: { offsetX: number; offsetY: number } }) {
  const faces = getPrefabFaces(card.prefabId);
  const size = getPrefabSize(card.prefabId) ?? { width: 120, height: 168 };
  const showFront = (card.kind === "card" || card.kind === "token") ? card.faceUp : true;
  const src = showFront ? faces?.[0] : faces?.[1];
  return (
    <div
      className="absolute rounded-lg overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.15)]"
      style={{
        left: offset.offsetX,
        top: offset.offsetY,
        width: size.width,
        height: size.height,
        backgroundColor: src ? undefined : card.faceUp ? "#ffffff" : "#1e3a5f",
      }}
    >
      {src && <img src={src} alt="" className="w-full h-full object-cover" />}
    </div>
  );
}
