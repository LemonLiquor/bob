"use client";

import { useState, useCallback, useMemo, useRef } from "react";
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
}

export default function GameBoard({ gameState: propState, onAction, initialState }: GameBoardProps) {
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
    dispatch({ type: "flip_card", cardId });
  }, [dispatch]);

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

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ cardId: string; x: number; y: number } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor),
  );

  function handleDragStart(event: DragStartEvent) {
    const cardId = String(event.active.id);
    // 视觉坐标（视口坐标 = 桌面坐标）：自由牌 / pile 顶牌 / 手牌区牌通用
    const el = document.getElementById(cardId);
    const rect = el?.getBoundingClientRect();
    dragStartRef.current = { cardId, x: rect?.left ?? 0, y: rect?.top ?? 0 };
    setIsDragging(true);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const cardId = String(active.id);
    const start = dragStartRef.current;
    dragStartRef.current = null;
    setIsDragging(false);
    if (!start) return;

    const overId = over ? String(over.id) : null;

    // 手牌区（自己的或他人的，沙盒允许拖入任何座位）
    if (overId && overId.startsWith("hand-")) {
      dispatch({ type: "move_to_hand", cardId, seatId: overId.slice("hand-".length) });
      return;
    }

    // 牌堆：对齐 pile 中心
    if (overId && overId.startsWith("pile-")) {
      const pile = gameState.piles.find((p) => p.id === overId);
      if (pile) {
        dispatch({ type: "move_card", cardId, x: pile.x, y: pile.y });
        return;
      }
    }

    // 桌面：落点 = 拖拽中真实位置（translated，含 transform，与视觉一致）
    // （游戏页全屏布局下 main 左上角 = 视口 (0,0)，视口坐标 = 桌面坐标，无需换算）
    const translated = active.rect.current.translated;
    if (translated) {
      const x = translated.left;
      const y = translated.top;
      // 防误触：几乎没移动则不处理
      if (Math.abs(x - start.x) > 2 || Math.abs(y - start.y) > 2) {
        dispatch({ type: "move_card", cardId, x, y });
      }
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
      className="h-full bg-desk relative overflow-hidden"
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
          disabled={isDragging}
        >
          {/* 自由牌 */}
          {freeCards.map((card) => (
            <div
              key={card.id}
              style={{ position: "absolute", left: card.x, top: card.y, zIndex: card.zIndex }}
            >
              <Card card={card} draggable />
            </div>
          ))}

          {/* 牌堆 */}
          {gameState.piles.map((pile) => (
            <Pile
              key={pile.id}
              pile={pile}
              cards={findCards(gameState, pile.entityIds)}
              onShuffle={handleShufflePile}
            />
          ))}

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
