"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import Pile from "@/components/game/Pile";
import Card from "@/components/game/Card";
import HandZone from "@/components/game/HandZone";
import OtherHandBar from "@/components/game/OtherHandBar";
import { applyAction, createSeat, findCards } from "@/lib/engine";
import { CardActionProvider } from "@/lib/engine/card-action";
import type { GameAction, GameState } from "@/lib/engine";
import { sessionStore } from "@/lib/multiplayer/session";

// ============================================================
// GameBoard — S9 自由坐标 + Pile + 手牌区（屏幕 UI 组件）
//   非受控（默认）：本地 useState，/game 单人沙盒使用
//   受控：外部 gameState + onAction，/room/[code] 多人使用
// ============================================================

interface GameBoardProps {
  gameState?: GameState;
  onAction?: (action: GameAction) => void;
  initialState?: GameState; // 非受控模式下的初始状态
  labMode?: boolean; // Lab 编辑模式：启用 Delete 删除 / Ctrl+D 复制（可选，不进协议）
  onLabDelete?: (id: string) => void;
  onLabCopy?: (id: string) => void;
}

export default function GameBoard({ gameState: propState, onAction, initialState, labMode, onLabDelete, onLabCopy }: GameBoardProps) {
  const controlled = propState !== undefined && onAction !== undefined;

  const [internalState, setInternalState] = useState<GameState>(() => {
    const initial = propState ?? initialState ?? {
      entities: [],
      piles: [],
      seats: [createSeat()],
    };
    // 单人模式：无座位时补一个虚拟座位（否则无手牌区、D 键失效）
    if (initial.seats.length === 0) {
      return { ...initial, seats: [createSeat()] };
    }
    return initial;
  });

  const gameState = controlled ? propState! : internalState;
  const playerId = controlled ? sessionStore.get()?.playerId ?? "" : "local";

  // 我的座位：单人 = 第一个座位；多人 = 按 playerId（未入座 = undefined，无手牌区）
  const mySeat = controlled
    ? gameState.seats.find((s) => s.playerId === playerId)
    : gameState.seats[0];
  const mySeatId = mySeat?.id ?? "";
  const otherSeats = controlled ? gameState.seats.filter((s) => s.id !== mySeatId) : [];

  const dispatch = useCallback((action: GameAction) => {
    if (controlled) {
      onAction!(action);
    } else {
      setInternalState((prev) => applyAction(prev, action));
    }
  }, [controlled, onAction]);

  const handleFlip = useCallback((cardId: string) => {
    // Token/版图单面禁翻：发送前拦截（省带宽；引擎 flipCard 防御保留）
    if (gameState.entities.find((e) => e.id === cardId)?.kind !== "card") return;
    dispatch({ type: "flip_card", cardId });
  }, [dispatch, gameState]);

  // R 键：hover 自由版图 → 顺时针旋转 90°（对局可用，协议动作；pile 内 R = 洗牌由 Pile 处理）
  const handleRotate = useCallback(
    (id: string) => {
      const entity = gameState.entities.find((e) => e.id === id);
      if (entity?.kind !== "board") return; // 仅版图可旋转
      dispatch({ type: "rotate_entity", entityId: id });
    },
    [gameState, dispatch],
  );

  // D 键：hover 任意牌 → 抓入手牌区（自由牌 / 牌堆顶牌 / 其他人手牌区均可，沙盒语义）
  const handleDraw = useCallback(
    (id: string) => {
      if (!mySeatId) return;
      // 已在手牌区 → 跳过（防重复）
      const mySeat = gameState.seats.find((s) => s.id === mySeatId);
      if (!mySeat || mySeat.handZone.entityIds.includes(id)) return;
      // 牌必须存在（moveCardToHand 内部也会校验，双保险）
      if (!gameState.entities.some((e) => e.id === id)) return;
      dispatch({ type: "move_to_hand", cardId: id, seatId: mySeatId });
    },
    [mySeatId, gameState, dispatch],
  );

  const handleShufflePile = useCallback((pileId: string) => {
    dispatch({ type: "shuffle_pile", pileId });
  }, [dispatch]);

  /** 翻整叠（hover 牌堆 + Shift+F）：pile 内 card faceUp 取反 */
  const handleFlipPile = useCallback((pileId: string) => {
    dispatch({ type: "flip_pile", pileId });
  }, [dispatch]);

  const [isDragging, setIsDragging] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null); // 拖动中的实体 id（拖动中 zIndex 置顶防被版图盖住）
  const [shiftHeld, setShiftHeld] = useState(false); // Shift 按住 = 整堆移动模式
  const dragStartRef = useRef<
    | { kind: "card"; cardId: string; x: number; y: number }
    | { kind: "pile"; pileId: string; x: number; y: number }
    | null
  >(null);

  // 桌面缩放/平移（会话 UI 状态，不入存档）：渲染容器 translate(pan) scale(zoom)，origin 0 0
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const mainRef = useRef<HTMLElement>(null);
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  // 视口 → 桌面坐标（引擎 state 语义）
  const toDesk = useCallback((vx: number, vy: number) => {
    const v = viewRef.current;
    return { x: (vx - v.x) / v.zoom, y: (vy - v.y) / v.zoom };
  }, []);

  // 滚轮缩放（鼠标为中心，保持鼠标下的桌面点不动）+ 拖拽空白平移
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const nz = Math.min(4, Math.max(0.2, v.zoom * factor));
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const dx = (mx - v.x) / v.zoom; // 鼠标下的桌面点（缩放前）
      const dy = (my - v.y) / v.zoom;
      setView({ x: mx - dx * nz, y: my - dy * nz, zoom: nz });
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-card-id]") || t.closest('[id^="pile-"]')) return; // 卡片/牌堆上不平移
      panRef.current = { sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y };
    };
    const onPointerMove = (e: PointerEvent) => {
      const p = panRef.current;
      if (!p) return;
      setView((v) => ({ ...v, x: p.ox + (e.clientX - p.sx), y: p.oy + (e.clientY - p.sy) }));
    };
    const onPointerUp = () => {
      panRef.current = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor),
  );

  // Shift 按住/松开 → 切换整堆移动模式；失焦时重置（防止卡住）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(false);
    };
    const onBlur = () => setShiftHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveId(id);
    if (id.startsWith("pile-move-")) {
      // 整堆拖动：取容器位置作起点
      const pileId = id.slice("pile-move-".length);
      const el = document.getElementById(`pile-${pileId}`);
      const rect = el?.getBoundingClientRect();
      dragStartRef.current = { kind: "pile", pileId, x: rect?.left ?? 0, y: rect?.top ?? 0 };
    } else {
      // 卡：视觉坐标（视口坐标 = 桌面坐标）：自由牌 / pile 顶牌 / 手牌区牌通用
      const el = document.getElementById(id);
      const rect = el?.getBoundingClientRect();
      dragStartRef.current = { kind: "card", cardId: id, x: rect?.left ?? 0, y: rect?.top ?? 0 };
    }
    setIsDragging(true);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const start = dragStartRef.current;
    dragStartRef.current = null;
    setIsDragging(false);
    setActiveId(null);
    if (!start) return;

    const translated = active.rect.current.translated;
    if (!translated) return;

    // 整堆移动：防误触（几乎没移动则不处理）；落点视口 → 桌面
    if (start.kind === "pile") {
      if (Math.abs(translated.left - start.x) > 2 || Math.abs(translated.top - start.y) > 2) {
        const p = toDesk(translated.left, translated.top);
        dispatch({ type: "move_pile", pileId: start.pileId, x: p.x, y: p.y });
      }
      return;
    }

    const cardId = start.cardId;
    const overId = over ? String(over.id) : null;

    // 手牌区（自己的或他人的，沙盒允许拖入任何座位）
    if (overId && overId.startsWith("hand-")) {
      dispatch({ type: "move_to_hand", cardId, seatId: overId.slice("hand-".length) });
      return;
    }

    // 牌堆：对齐 pile 中心（版图不入堆 → 自由放置到 pile 位置）
    if (overId && overId.startsWith("pile-") && !overId.startsWith("pile-move-")) {
      const pile = gameState.piles.find((p) => p.id === overId);
      if (pile) {
        dispatch({ type: "move_card", cardId, x: pile.x, y: pile.y });
        return;
      }
    }

    // 桌面：落点 = 拖拽中真实位置（translated 视口坐标 → 桌面坐标）
    // 版图旋转 = 有效尺寸分支渲染，包围盒恒等于引擎坐标，无额外换算
    const p = toDesk(translated.left, translated.top);
    const x = p.x;
    const y = p.y;
    // 防误触：几乎没移动则不处理（比较仍用视口坐标）
    if (Math.abs(translated.left - start.x) > 2 || Math.abs(translated.top - start.y) > 2) {
      dispatch({ type: "move_card", cardId, x, y });
    }
  }

  // 自由牌 = 不在任何 pile / 手牌区
  const inContainer = useMemo(() => {
    const set = new Set<string>();
    for (const p of gameState.piles) for (const id of p.entityIds) set.add(id);
    for (const s of gameState.seats) for (const id of s.handZone.entityIds) set.add(id);
    return set;
  }, [gameState]);

  const freeCards = gameState.entities.filter((e) => !inContainer.has(e.id));

  return (
    <main
      ref={mainRef}
      className="h-full board-surface relative overflow-hidden"
    >
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        id="avoid_SSR_Hydration_Mismatch"
      >
        <CardActionProvider
          onFlip={handleFlip}
          onDraw={handleDraw}
          onRotate={handleRotate}
          onDelete={labMode ? onLabDelete : undefined}
          onCopy={labMode ? onLabCopy : undefined}
          disabled={isDragging}
        >
          {/* 桌面内容（缩放/平移容器；手牌区等屏幕 UI 在容器外不受影响） */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              transformOrigin: "0 0",
            }}
          >
            {/* 桌面网格（桌面坐标层：随容器缩放平移；垫底且不拦截事件） */}
            <div
              className="board-grid"
              style={{
                position: "absolute",
                left: -20000,
                top: -20000,
                width: 40000,
                height: 40000,
                zIndex: -1,
                pointerEvents: "none",
              }}
            />
            {/* 自由牌 */}
            {freeCards.map((card) => (
              <div
                key={card.id}
                style={{ position: "absolute", left: card.x, top: card.y, zIndex: activeId === card.id ? 9999 : card.zIndex }}
              >
                <Card card={card} draggable zoom={view.zoom} />
              </div>
            ))}

            {/* 牌堆 */}
            {gameState.piles.map((pile) => (
              <Pile
                key={pile.id}
                pile={pile}
                cards={findCards(gameState, pile.entityIds)}
                onShuffle={handleShufflePile}
                onFlipPile={handleFlipPile}
                shiftHeld={shiftHeld}
                zoom={view.zoom}
              />
            ))}
          </div>

          {/* 自己的手牌区（屏幕底部，spread 展开） */}
          {mySeat && (
            <HandZone seat={mySeat} cards={findCards(gameState, mySeat.handZone.entityIds)} />
          )}

          {/* 其他玩家的手牌区（屏幕顶部，折叠条） */}
          {otherSeats.length > 0 && (
            <div className="fixed top-2 left-1/2 -translate-x-1/2 flex gap-2 z-40">
              {otherSeats.map((seat) => (
                <OtherHandBar key={seat.id} seat={seat} />
              ))}
            </div>
          )}
        </CardActionProvider>
      </DndContext>
    </main>
  );
}
