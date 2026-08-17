import type { CardState, GameState, Pile } from "./types";
import { CARD_WIDTH, CARD_HEIGHT, OVERLAP_DISTANCE, TABLE_CENTER } from "./layout";

// ============================================================
// S9 引擎 — 自由坐标 + Pile。纯函数，不可变更新，零 UI 依赖
// ============================================================

function findCard(state: GameState, cardId: string): CardState | undefined {
  return state.cards.find((c) => c.id === cardId);
}

function maxZIndex(state: GameState): number {
  return state.cards.reduce((max, c) => Math.max(max, c.zIndex), 0);
}

/** 计算卡牌中心点 */
function centerOf(x: number, y: number): { cx: number; cy: number } {
  return { cx: x + CARD_WIDTH / 2, cy: y + CARD_HEIGHT / 2 };
}

function distance(
  ax: number, ay: number,
  bx: number, by: number,
): number {
  return Math.hypot(ax - bx, ay - by);
}

/** 从所有容器（piles / handZones）中移除 cardId。不可变更新 */
function removeFromContainers(state: GameState, cardId: string): GameState {
  const inPile = state.piles.some((p) => p.cardIds.includes(cardId));
  const inHand = state.seats.some((s) => s.handZone.cardIds.includes(cardId));
  if (!inPile && !inHand) return state;

  return {
    ...state,
    piles: state.piles.map((p) =>
      p.cardIds.includes(cardId)
        ? { ...p, cardIds: p.cardIds.filter((id) => id !== cardId) }
        : p,
    ),
    seats: state.seats.map((s) =>
      s.handZone.cardIds.includes(cardId)
        ? { ...s, handZone: { cardIds: s.handZone.cardIds.filter((id) => id !== cardId) } }
        : s,
    ),
  };
}

/**
 * 从所有容器移除 cardId；若来自 pile 且移除后剩余 ≤ 1 张 → 解散 pile（空堆/单张不成堆）。
 * 所有移出牌的路径都必须走这里，否则会残留空 pile。
 */
function removeCard(state: GameState, cardId: string): GameState {
  const pile = state.piles.find((p) => p.cardIds.includes(cardId));
  const next = removeFromContainers(state, cardId);
  if (pile) {
    const remaining = pile.cardIds.filter((id) => id !== cardId);
    if (remaining.length <= 1) {
      return { ...next, piles: next.piles.filter((p) => p.id !== pile.id) };
    }
  }
  return next;
}

export interface OverlapTarget {
  pile?: Pile;
  card?: CardState;
}

/**
 * 查找与落点 (x, y) 重叠（中心距 < OVERLAP_DISTANCE）的牌堆或自由卡牌。
 * 优先级：pile > 自由牌。pile 中的牌由 pile 位置代表，不单独命中。
 */
export function findOverlap(state: GameState, x: number, y: number, excludeId?: string): OverlapTarget {
  const { cx, cy } = centerOf(x, y);

  // 1. pile 优先
  for (const pile of state.piles) {
    const pc = centerOf(pile.x, pile.y);
    if (distance(cx, cy, pc.cx, pc.cy) < OVERLAP_DISTANCE) {
      return { pile };
    }
  }

  // 2. 自由牌（不在任何 pile / handZone 中）
  const inContainer = (id: string) =>
    state.piles.some((p) => p.cardIds.includes(id)) ||
    state.seats.some((s) => s.handZone.cardIds.includes(id));

  for (const card of state.cards) {
    if (card.id === excludeId) continue;
    if (inContainer(card.id)) continue;
    const cc = centerOf(card.x, card.y);
    if (distance(cx, cy, cc.cx, cc.cy) < OVERLAP_DISTANCE) {
      return { card };
    }
  }

  return {};
}

/**
 * 落点处理：把 cardId 放到 (x, y)。
 * - 重叠 pile → 入堆顶部
 * - 重叠自由牌 → 自动建堆（两张入堆）
 * - 空处 → 自由坐标 + zIndex 置顶
 */
function placeAt(state: GameState, cardId: string, x: number, y: number): GameState {
  const target = findOverlap(state, x, y, cardId);

  // 重叠 pile → 入堆
  if (target.pile) {
    return {
      ...state,
      piles: state.piles.map((p) =>
        p.id === target.pile!.id ? { ...p, cardIds: [...p.cardIds, cardId] } : p,
      ),
    };
  }

  // 重叠自由牌 → 自动建堆
  if (target.card) {
    const pile: Pile = {
      id: `pile-${Date.now()}`,
      cardIds: [target.card.id, cardId],
      x,
      y,
    };
    return { ...state, piles: [...state.piles, pile] };
  }

  // 空处 → 自由坐标，zIndex 置顶
  const z = maxZIndex(state) + 1;
  return {
    ...state,
    cards: state.cards.map((c) => (c.id === cardId ? { ...c, x, y, zIndex: z } : c)),
  };
}

/**
 * 将 cardId 移动到桌面坐标 (x, y)。可来自自由位置 / pile / 手牌区。
 * 若来自 pile 且移出后剩余 ≤ 1 张 → 解散 pile（剩余牌恢复原始坐标）。
 */
export function moveCard(state: GameState, cardId: string, x: number, y: number): GameState {
  const card = findCard(state, cardId);
  if (!card) return state;
  const removed = removeCard(state, cardId);
  return placeAt(removed, cardId, x, y);
}

/** 牌加入指定座位的手牌区末尾。seatId 任意（沙盒允许塞进任何座位） */
export function moveCardToHand(state: GameState, cardId: string, seatId: string): GameState {
  const card = findCard(state, cardId);
  const seat = state.seats.find((s) => s.id === seatId);
  if (!card || !seat) return state;

  const removed = removeCard(state, cardId);
  return {
    ...removed,
    seats: removed.seats.map((s) =>
      s.id === seatId ? { ...s, handZone: { cardIds: [...s.handZone.cardIds, cardId] } } : s,
    ),
  };
}

/** 牌从手牌区移出，放到桌面坐标 (x, y)（含落点重叠处理）。委托 moveCard */
export function moveCardFromHand(state: GameState, cardId: string, x: number, y: number): GameState {
  return moveCard(state, cardId, x, y);
}

/** 牌加入 pile 顶部（可来自自由位置 / 手牌区 / 其他 pile） */
export function moveCardToPile(state: GameState, cardId: string, pileId: string): GameState {
  const card = findCard(state, cardId);
  const pile = state.piles.find((p) => p.id === pileId);
  if (!card || !pile) return state;

  const removed = removeCard(state, cardId);
  const stillExists = removed.piles.some((p) => p.id === pileId);
  if (stillExists) {
    return {
      ...removed,
      piles: removed.piles.map((p) =>
        p.id === pileId ? { ...p, cardIds: [...p.cardIds, cardId] } : p,
      ),
    };
  }

  // 目标 pile 因移出而解散（拖牌放回自己所在的 ≤2 张 pile）→ 重建单张 pile
  return { ...removed, piles: [...removed.piles, { ...pile, cardIds: [cardId] }] };
}

/**
 * 牌从 pile 移出，放到桌面坐标 (x, y)。委托 moveCard（含解散逻辑）。
 */
export function moveCardFromPile(state: GameState, cardId: string, x: number, y: number): GameState {
  return moveCard(state, cardId, x, y);
}

/** 打乱指定 pile 中的卡牌顺序（Fisher-Yates）。不可变更新 */
export function shufflePile(state: GameState, pileId: string): GameState {
  const pile = state.piles.find((p) => p.id === pileId);
  if (!pile || pile.cardIds.length <= 1) return state;

  const shuffled = [...pile.cardIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return {
    ...state,
    piles: state.piles.map((p) => (p.id === pileId ? { ...p, cardIds: shuffled } : p)),
  };
}

/** 翻转指定卡牌的朝向。不可变更新 */
export function flipCard(state: GameState, cardId: string): GameState {
  const cardIndex = state.cards.findIndex((c) => c.id === cardId);
  if (cardIndex === -1) return state;

  const card = state.cards[cardIndex];
  return {
    ...state,
    cards: [
      ...state.cards.slice(0, cardIndex),
      { ...card, faceUp: !card.faceUp },
      ...state.cards.slice(cardIndex + 1),
    ],
  };
}

/**
 * 离座 / 离开房间时：座位手牌掉落为自由牌（桌面中心区域，随机小偏移散落），手牌区清空。
 */
export function dropHandToTable(state: GameState, seatId: string): GameState {
  const seat = state.seats.find((s) => s.id === seatId);
  if (!seat || seat.handZone.cardIds.length === 0) return state;

  let z = maxZIndex(state);
  const dropMap = new Map<string, { x: number; y: number; zIndex: number }>();
  for (const id of seat.handZone.cardIds) {
    z += 1;
    dropMap.set(id, {
      x: TABLE_CENTER.x + Math.round((Math.random() - 0.5) * 40),
      y: TABLE_CENTER.y + Math.round((Math.random() - 0.5) * 40),
      zIndex: z,
    });
  }

  return {
    ...state,
    cards: state.cards.map((c) => {
      const drop = dropMap.get(c.id);
      return drop ? { ...c, ...drop } : c;
    }),
    seats: state.seats.map((s) =>
      s.id === seatId ? { ...s, handZone: { cardIds: [] } } : s,
    ),
  };
}
