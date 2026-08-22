import type { EntityState, GameState, Pile, Rotation } from "./types";
import { CARD_WIDTH, CARD_HEIGHT, OVERLAP_DISTANCE, TABLE_CENTER } from "./layout";

// ============================================================
// S9 引擎 — 自由坐标 + Pile。纯函数，不可变更新，零 UI 依赖
// 注：动作字段仍叫 cardId（协议兼容），操作对象是实例 id（EntityState.id）
// ============================================================

function findCard(state: GameState, cardId: string): EntityState | undefined {
  return state.entities.find((e) => e.id === cardId);
}

function maxZIndex(state: GameState): number {
  return state.entities.reduce((max, e) => Math.max(max, e.zIndex), 0);
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
  const inPile = state.piles.some((p) => p.entityIds.includes(cardId));
  const inHand = state.seats.some((s) => s.handZone.entityIds.includes(cardId));
  if (!inPile && !inHand) return state;

  return {
    ...state,
    piles: state.piles.map((p) =>
      p.entityIds.includes(cardId)
        ? { ...p, entityIds: p.entityIds.filter((id) => id !== cardId) }
        : p,
    ),
    seats: state.seats.map((s) =>
      s.handZone.entityIds.includes(cardId)
        ? { ...s, handZone: { entityIds: s.handZone.entityIds.filter((id) => id !== cardId) } }
        : s,
    ),
  };
}

/**
 * 从所有容器移除 cardId；若来自 pile 且移除后剩余 ≤ 1 张 → 解散 pile（空堆/单张不成堆）。
 * 所有移出牌的路径都必须走这里，否则会残留空 pile。
 */
function removeCard(state: GameState, cardId: string): GameState {
  const pile = state.piles.find((p) => p.entityIds.includes(cardId));
  const next = removeFromContainers(state, cardId);
  if (pile) {
    const remaining = pile.entityIds.filter((id) => id !== cardId);
    if (remaining.length <= 1) {
      return { ...next, piles: next.piles.filter((p) => p.id !== pile.id) };
    }
  }
  return next;
}

export interface OverlapTarget {
  pile?: Pile;
  card?: EntityState;
}

/**
 * 查找与落点 (x, y) 重叠（中心距 < 阈值）的牌堆或自由卡牌。
 * 阈值按目标实体尺寸：短边/2（上限 OVERLAP_DISTANCE）——小实体更近才算重叠。
 * 优先级：pile > 自由牌。pile 中的牌由 pile 位置代表，不单独命中。
 */
export function findOverlap(state: GameState, x: number, y: number, excludeId?: string): OverlapTarget {
  const { cx, cy } = centerOf(x, y);
  const threshold = (e?: EntityState): number => {
    if (!e) return OVERLAP_DISTANCE;
    const s = e.size ?? { width: 120, height: 168 };
    return Math.min(OVERLAP_DISTANCE, Math.min(s.width, s.height) / 2);
  };

  // 1. pile 优先（阈值按堆内实体尺寸）
  for (const pile of state.piles) {
    const pc = centerOf(pile.x, pile.y);
    const pileCard = state.entities.find((e) => e.id === pile.entityIds[0]);
    if (distance(cx, cy, pc.cx, pc.cy) < threshold(pileCard)) {
      return { pile };
    }
  }

  // 2. 自由牌（不在任何 pile / handZone 中）
  const inContainer = (id: string) =>
    state.piles.some((p) => p.entityIds.includes(id)) ||
    state.seats.some((s) => s.handZone.entityIds.includes(id));

  for (const card of state.entities) {
    if (card.id === excludeId) continue;
    if (inContainer(card.id)) continue;
    const cc = centerOf(card.x, card.y);
    if (distance(cx, cy, cc.cx, cc.cy) < threshold(card)) {
      return { card };
    }
  }

  return {};
}

/** 尺寸相同才可堆叠（缺省 120×168 卡牌） */
function sameSize(a: EntityState, b: EntityState): boolean {
  const da = a.size ?? { width: 120, height: 168 };
  const db = b.size ?? { width: 120, height: 168 };
  return da.width === db.width && da.height === db.height;
}

/**
 * 落点处理：把 cardId 放到 (x, y)。
 * - 重叠 pile（且尺寸相同）→ 入堆顶部
 * - 重叠自由牌（且尺寸相同）→ 自动建堆（两张入堆）
 * - 空处 / 尺寸不同 → 自由坐标 + zIndex 置顶
 */
function placeAt(state: GameState, cardId: string, x: number, y: number): GameState {
  const card = findCard(state, cardId);
  if (!card) return state;
  const target = findOverlap(state, x, y, cardId);

  // 重叠 pile → 目标牌是版图或尺寸不同 → 不入堆（版图不可叠，自由放置）
  if (target.pile) {
    const pileCard = state.entities.find((e) => e.id === target.pile!.entityIds[0]);
    if (card.kind !== "board" && pileCard && pileCard.kind !== "board" && sameSize(pileCard, card)) {
      return {
        ...state,
        piles: state.piles.map((p) =>
          p.id === target.pile!.id ? { ...p, entityIds: [...p.entityIds, cardId] } : p,
        ),
      };
    }
  }

  // 重叠自由牌 → 任一方是版图或尺寸不同 → 不自动建堆
  if (target.card) {
    if (card.kind !== "board" && target.card.kind !== "board" && sameSize(target.card, card)) {
      const pile: Pile = {
        id: `pile-${Date.now()}`,
        entityIds: [target.card.id, cardId],
        x,
        y,
      };
      return { ...state, piles: [...state.piles, pile] };
    }
  }

  // 空处 / 尺寸不同 → 自由坐标，zIndex 置顶
  const z = maxZIndex(state) + 1;
  return {
    ...state,
    entities: state.entities.map((e) => (e.id === cardId ? { ...e, x, y, zIndex: z } : e)),
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

/** 牌加入指定座位的手牌区末尾。seatId 任意（沙盒允许塞进任何座位）。版图不可入手牌 */
export function moveCardToHand(state: GameState, cardId: string, seatId: string): GameState {
  const card = findCard(state, cardId);
  const seat = state.seats.find((s) => s.id === seatId);
  if (!card || !seat) return state;
  if (card.kind === "board") return state; // 版图不入手牌区

  const removed = removeCard(state, cardId);
  return {
    ...removed,
    seats: removed.seats.map((s) =>
      s.id === seatId ? { ...s, handZone: { entityIds: [...s.handZone.entityIds, cardId] } } : s,
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
        p.id === pileId ? { ...p, entityIds: [...p.entityIds, cardId] } : p,
      ),
    };
  }

  // 目标 pile 因移出而解散（拖牌放回自己所在的 ≤2 张 pile）→ 重建单张 pile
  return { ...removed, piles: [...removed.piles, { ...pile, entityIds: [cardId] }] };
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
  if (!pile || pile.entityIds.length <= 1) return state;

  const shuffled = [...pile.entityIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return {
    ...state,
    piles: state.piles.map((p) => (p.id === pileId ? { ...p, entityIds: shuffled } : p)),
  };
}

/** 移动整个牌堆到桌面坐标 (x, y)。不可变更新 */
export function movePile(state: GameState, pileId: string, x: number, y: number): GameState {
  const pile = state.piles.find((p) => p.id === pileId);
  if (!pile) return state;
  return {
    ...state,
    piles: state.piles.map((p) => (p.id === pileId ? { ...p, x, y } : p)),
  };
}

/** 翻转指定实体的朝向。Token/版图单面禁翻（渲染恒正面，直接忽略）。不可变更新 */
export function flipCard(state: GameState, cardId: string): GameState {
  const cardIndex = state.entities.findIndex((e) => e.id === cardId);
  if (cardIndex === -1) return state;
  const card = state.entities[cardIndex];
  if (card.kind !== "card") return state; // 仅卡牌可翻（token/board 单面）
  return {
    ...state,
    entities: [
      ...state.entities.slice(0, cardIndex),
      { ...card, faceUp: !card.faceUp },
      ...state.entities.slice(cardIndex + 1),
    ],
  };
}

/**
 * 顺时针旋转 90°（仅版图生效；卡牌/Token 忽略）。不可变更新。
 * 只改 rotation；尺寸保持原始（渲染/计算处按 rotation 分支取有效尺寸，见 Card 的 boardRotated）。
 */
export function rotateEntity(state: GameState, entityId: string): GameState {
  const index = state.entities.findIndex((e) => e.id === entityId);
  if (index === -1) return state;
  const entity = state.entities[index];
  if (entity.kind !== "board") return state; // 仅版图可旋转
  const next = ((entity.rotation + 90) % 360) as Rotation;
  return {
    ...state,
    entities: [
      ...state.entities.slice(0, index),
      { ...entity, rotation: next },
      ...state.entities.slice(index + 1),
    ],
  };
}

/**
 * 删除实体（Lab 本地编辑用，**不进动作注册表/协议**）：
 * 从容器（piles/handZones）移除 + 剩余 ≤1 张解散堆 + 从实体列表删除实例。
 * 实体不存在 → 原状态。不可变更新。
 */
export function removeEntity(state: GameState, entityId: string): GameState {
  const exists = state.entities.some((e) => e.id === entityId);
  if (!exists) return state;
  const removed = removeCard(state, entityId);
  return { ...removed, entities: removed.entities.filter((e) => e.id !== entityId) };
}

/**
 * 离座 / 离开房间时：座位手牌掉落为自由牌（桌面中心区域，随机小偏移散落），手牌区清空。
 */
export function dropHandToTable(state: GameState, seatId: string): GameState {
  const seat = state.seats.find((s) => s.id === seatId);
  if (!seat || seat.handZone.entityIds.length === 0) return state;

  let z = maxZIndex(state);
  const dropMap = new Map<string, { x: number; y: number; zIndex: number }>();
  for (const id of seat.handZone.entityIds) {
    z += 1;
    dropMap.set(id, {
      x: TABLE_CENTER.x + Math.round((Math.random() - 0.5) * 40),
      y: TABLE_CENTER.y + Math.round((Math.random() - 0.5) * 40),
      zIndex: z,
    });
  }

  return {
    ...state,
    entities: state.entities.map((e) => {
      const drop = dropMap.get(e.id);
      return drop ? { ...e, ...drop } : e;
    }),
    seats: state.seats.map((s) =>
      s.id === seatId ? { ...s, handZone: { entityIds: [] } } : s,
    ),
  };
}
