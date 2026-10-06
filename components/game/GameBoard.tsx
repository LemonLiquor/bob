"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import Pile from "@/components/game/Pile";
import Card from "@/components/game/Card";
import HandZone from "@/components/game/HandZone";
import OtherHandBar from "@/components/game/OtherHandBar";
import { applyAction, createSeat, findCards, assignParents, worldOf, deriveScene } from "@/lib/engine";
import { CardActionProvider } from "@/lib/engine/card-action";
import type { GameAction, GameState, EntityState } from "@/lib/engine";
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
    // 非受控（单机试玩）入口兜底：initialState 可能无 parentId（旧存档），补一次归属
    const assigned = assignParents(initial);
    // 单人模式：无座位时补一个虚拟座位（否则无手牌区、D 键失效）
    if (assigned.seats.length === 0) {
      return { ...assigned, seats: [createSeat()] };
    }
    return assigned;
  });

  const gameState = controlled ? propState! : internalState;
  const playerId = controlled ? sessionStore.get()?.playerId ?? "" : "local";

  // 我的座位：单人 = 第一个座位；多人 = 按 playerId（未入座 = undefined，无手牌区）
  const mySeat = controlled
    ? gameState.seats.find((s) => s.playerId === playerId)
    : gameState.seats[0];
  const mySeatId = mySeat?.id ?? "";
  const otherSeats = controlled ? gameState.seats.filter((s) => s.id !== mySeatId) : [];
  const [shiftHeld, setShiftHeld] = useState(false); // Shift 按住 = 整堆移动模式（声明提前供 handleRotate 使用）

  const dispatch = useCallback((action: GameAction) => {
    if (controlled) {
      onAction!(action);
    } else {
      setInternalState((prev) => applyAction(prev, action));
    }
  }, [controlled, onAction]);

  const handleFlip = useCallback((cardId: string) => {
    const entity = gameState.entities.find((e) => e.id === cardId);
    // 卡牌 = 翻面；die = 掷骰（随机数 UI 生成，引擎保持纯函数）
    if (entity?.kind === "card") {
      dispatch({ type: "flip_card", cardId });
    } else if (entity?.kind === "die") {
      dispatch({ type: "set_die", entityId: cardId, value: 1 + Math.floor(Math.random() * (entity.sides ?? 6)) });
    }
  }, [dispatch, gameState]);

  // R 键：hover 版图 → 顺时针旋转 90°；hover die → 点数 ±1（Shift+R = -1，setDie 内 clamp）
  const handleRotate = useCallback(
    (id: string) => {
      const entity = gameState.entities.find((e) => e.id === id);
      if (entity?.kind === "board") {
        dispatch({ type: "rotate_entity", entityId: id });
      } else if (entity?.kind === "die") {
        dispatch({ type: "set_die", entityId: id, value: (entity.value ?? 1) + (shiftHeld ? -1 : 1) });
      }
    },
    [gameState, dispatch, shiftHeld],
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
  // 拖拽累计位移（视口坐标）：版图拖动时叠加到其后代的渲染坐标（拍平渲染的跟随机制）
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 });
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

  // 仅 PointerSensor：KeyboardSensor 的 Space/Enter 会在焦点残留的牌/版图上
  // 误触键盘拖拽（版图瞬移回原位）。键盘无障碍由 F/R/D 悬停快捷键承担
  const sensors = useSensors(useSensor(PointerSensor));

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
    setDragDelta({ x: 0, y: 0 });
    setIsDragging(true);
  }

  // 拖动中：记录累计位移（视口坐标），被拖版图的后代渲染位置叠加此 delta（渲染时 ÷zoom）
  function handleDragMove(event: DragMoveEvent) {
    setDragDelta({ x: event.delta.x, y: event.delta.y });
  }

  // ESC 取消拖拽：清拖拽状态（防位移残留卡住视觉）
  function handleDragCancel() {
    dragStartRef.current = null;
    setIsDragging(false);
    setActiveId(null);
    setDragDelta({ x: 0, y: 0 });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const start = dragStartRef.current;
    dragStartRef.current = null;
    setIsDragging(false);
    setActiveId(null);
    setDragDelta({ x: 0, y: 0 });
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
        // 落点必须是世界坐标：pile 在版图上时 x/y 是相对坐标，需 worldOf 换算（否则判定错乱、牌脱版图）
        const w = worldOf(gameState, pile);
        dispatch({ type: "move_card", cardId, x: w.x, y: w.y });
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

  // 场景派生：位置/z 序/跟随/成员资格的全部不变量集中在 deriveScene（lib/engine/scene.ts）
  const scene = useMemo(
    () => deriveScene(gameState, { activeId, delta: dragDelta, zoom: view.zoom }),
    [gameState, activeId, dragDelta, view.zoom],
  );

  return (
    <main
      ref={mainRef}
      className="h-full board-surface relative overflow-clip"
    >
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
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
            {/* 平铺实体层：坐标与 z 全部来自场景派生（lib/engine/scene.ts） */}
            {scene.entities.map((s) =>
              s.entity.kind === "board" ? (
                <FlatBoard key={s.id} board={s.entity} pos={{ x: s.x, y: s.y }} z={s.z} zoom={view.zoom} />
              ) : (
                <div key={s.id} style={{ position: "absolute", left: s.x, top: s.y, zIndex: s.z }}>
                  <Card card={s.entity} draggable zoom={view.zoom} />
                </div>
              ),
            )}

            {/* 平铺牌堆层：堆内牌渲染在 Pile 内部（自包含单元，无需逃逸） */}
            {scene.piles.map((s) => (
              <div key={s.id} style={{ position: "absolute", left: s.x, top: s.y, zIndex: s.z || undefined }}>
                <Pile
                  pile={s.pile}
                  cards={findCards(gameState, s.pile.entityIds)}
                  onShuffle={handleShufflePile}
                  onFlipPile={handleFlipPile}
                  shiftHeld={shiftHeld}
                  zoom={view.zoom}
                />
              </div>
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

// ============================================================
// 拍平渲染辅助
// 位置 / z 序 / 跟随的不变量全部在 lib/engine/scene.ts 的 deriveScene，
// 此处只剩渲染组件（FlatBoard = droppable 悬停高亮的载体）。
// ============================================================

/** 平级版图：droppable 悬停高亮（放置语义由引擎 placeAt 落点判定，此处只做反馈） */
function FlatBoard({ board, pos, z, zoom }: { board: EntityState; pos: { x: number; y: number }; z: number; zoom: number }) {
  const { isOver, setNodeRef } = useDroppable({ id: board.id });
  return (
    <div
      ref={setNodeRef}
      data-board-id={board.id}
      className={`rounded-lg ${isOver ? "ring-2 ring-highlight" : ""}`}
      style={{ position: "absolute", left: pos.x, top: pos.y, zIndex: z }}
    >
      <Card card={board} draggable zoom={zoom} />
    </div>
  );
}
