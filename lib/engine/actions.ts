import type { EntityState, GameState, Pile, Rotation, Size } from "./types";
import { CARD_WIDTH, CARD_HEIGHT, OVERLAP_DISTANCE, TABLE_CENTER } from "./layout";
import { diagLog } from "../diagnostics/log";

// ============================================================
// S9 引擎 — 自由坐标 + Pile。纯函数，不可变更新，零 UI 依赖
// 注：动作字段仍叫 cardId（协议兼容），操作对象是实例 id（EntityState.id）
// diagLog 仅记录内存诊断（落点 bug 排查期埋点，定位后移除）
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

/** 从所有容器移除 cardId。**永不解散 pile**（剩 1 张也保留，堆位置/归属承载剩余牌） */
function removeCard(state: GameState, cardId: string): GameState {
  return removeFromContainers(state, cardId);
}

/** 移除空 pile（move 动作末尾调用：牌移走后 entityIds 为空的堆无意义） */
function pruneEmptyPiles(state: GameState): GameState {
  const hasEmpty = state.piles.some((p) => p.entityIds.length === 0);
  if (!hasEmpty) return state;
  return { ...state, piles: state.piles.filter((p) => p.entityIds.length > 0) };
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

  // 1. pile 优先（阈值按堆内实体尺寸；空堆不参与判定）
  for (const pile of state.piles) {
    if (pile.entityIds.length === 0) continue;
    const pw = worldOf(state, pile);
    const pc = centerOf(pw.x, pw.y);
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
    const cw = worldOf(state, card);
    const cc = centerOf(cw.x, cw.y);
    if (distance(cx, cy, cc.cx, cc.cy) < threshold(card)) {
      return { card };
    }
  }

  return {};
}

// ============================================================
// 版图归属（parentId）— 坐标语义：相对坐标
// parentId 非空 → x/y 是相对父版图容器的坐标；parentId 空 → x/y 是世界坐标（桌面坐标系）
// 移动版图只改版图自身坐标，子实体坐标不动（渲染 DOM 层级天然跟随），引擎零移动逻辑
// ============================================================

/** 实体的有效尺寸（board 旋转 90/270 时宽高互换，与渲染 Card.tsx boardRotated 一致） */
function effectiveSize(e: EntityState): { width: number; height: number } {
  const base = e.size ?? { width: 120, height: 168 };
  const rotated = e.kind === "board" && (e.rotation === 90 || e.rotation === 270);
  return rotated ? { width: base.height, height: base.width } : base;
}

/** 实体/牌堆的世界坐标（沿 parentId 链上溯求和；环保护）。UI 落点换算也用它 */
export function worldOf(state: GameState, e: { parentId?: string; x: number; y: number }): { x: number; y: number } {
  let x = e.x;
  let y = e.y;
  let pid = e.parentId;
  const seen = new Set<string>();
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    const p = state.entities.find((ent) => ent.id === pid);
    if (!p) break;
    x += p.x;
    y += p.y;
    pid = p.parentId;
  }
  return { x, y };
}

/** targetId 的 parentId 链是否经过 ancestorId（自挂/成环防护）。参数 undefined 安全 */
function hasAncestor(state: GameState, targetId: string | undefined, ancestorId: string | undefined): boolean {
  if (!ancestorId) return false;
  let pid = targetId;
  const seen = new Set<string>();
  while (pid && !seen.has(pid)) {
    if (pid === ancestorId) return true;
    seen.add(pid);
    pid = state.entities.find((e) => e.id === pid)?.parentId;
  }
  return false;
}

/**
 * 落点 (x, y)（世界坐标，实体左上角，size 为落点实体渲染尺寸）中心命中的"宿主"实体。
 * 任意实体可做父（卡牌放 token 上、token 放卡牌上、版图嵌套…）；
 * 中心点在宿主世界矩形内；多个重叠取 zIndex 最高。
 * excludeIds 排除自身/参与建堆的牌（堆成员不能做宿主）；宿主位于自身后代链上的跳过（防自挂/成环）；
 * 堆内/手牌实体不做宿主（其位置由堆/座位代表）。
 */
function findHostAt(state: GameState, x: number, y: number, size?: Size, excludeIds: readonly string[] = []): EntityState | undefined {
  const w = size?.width ?? 120;
  const h = size?.height ?? 168;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const inContainer = (id: string) =>
    state.piles.some((p) => p.entityIds.includes(id)) ||
    state.seats.some((s) => s.handZone.entityIds.includes(id));

  let hit: EntityState | undefined;
  for (const e of state.entities) {
    if (excludeIds.includes(e.id)) continue;
    if (inContainer(e.id)) continue;
    if (hasAncestor(state, e.parentId, excludeIds[0])) continue;
    const ew = worldOf(state, e);
    const s = effectiveSize(e);
    if (cx >= ew.x && cx <= ew.x + s.width && cy >= ew.y && cy <= ew.y + s.height) {
      if (!hit || e.zIndex > hit.zIndex) hit = e;
    }
  }
  return hit;
}

/**
 * 补归属（幂等）：中心在版图世界矩形内的实体/牌堆写 parentId 并换算为相对坐标。
 * initialState 构建/加载兜底（旧存档无 parentId、坐标 = 世界）；已有归属的不动
 * 堆内实体不参与（引擎坐标是入堆前的残留，归属由堆代表，防双重移动）
 */
export function assignParents(state: GameState): GameState {
  const inPile = new Set<string>();
  for (const p of state.piles) for (const id of p.entityIds) inPile.add(id);
  const entities = state.entities.map((e) => {
    // 跳过：堆内实体（坐标是残留）/ 已有归属 / 版图自身（批量判定会互相包含成环，嵌套版图归属靠运行时放置写入）
    if (inPile.has(e.id) || e.parentId || e.kind === "board") return e;
    const host = findHostAt(state, e.x, e.y, e.size, [e.id]);
    if (!host) return e;
    const hw = worldOf(state, host);
    return { ...e, parentId: host.id, x: e.x - hw.x, y: e.y - hw.y };
  });
  const piles = state.piles.map((p) => {
    if (p.parentId) return p;
    const first = state.entities.find((e) => e.id === p.entityIds[0]);
    const host = findHostAt(state, p.x, p.y, first?.size, [p.id]);
    if (!host) return p;
    const hw = worldOf(state, host);
    return { ...p, parentId: host.id, x: p.x - hw.x, y: p.y - hw.y };
  });
  const eChanged = entities.some((e, i) => e !== state.entities[i]);
  const pChanged = piles.some((p, i) => p !== state.piles[i]);
  if (!eChanged && !pChanged) return state;
  return { ...state, entities, piles };
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
  diagLog("placeAt", {
    cardId,
    kind: card.kind,
    drop: { x, y },
    hit: target.pile ? { pile: target.pile.id, n: target.pile.entityIds.length } : target.card ? { card: target.card.id, size: target.card.size } : null,
  });

  // 重叠 pile → 目标牌是版图或尺寸不同 → 不入堆（版图不可叠，自由放置）
  if (target.pile) {
    const pileCard = state.entities.find((e) => e.id === target.pile!.entityIds[0]);
    if (card.kind !== "board" && pileCard && pileCard.kind !== "board" && sameSize(pileCard, card)) {
      diagLog("placeAt.decision", { branch: "into-pile", pile: target.pile.id });
      return {
        ...state,
        // 入堆：牌的归属由堆代表（堆的 parentId 管跟随），牌自身脱离版图
        entities: state.entities.map((e) => (e.id === cardId ? { ...e, parentId: undefined } : e)),
        piles: state.piles.map((p) =>
          p.id === target.pile!.id ? { ...p, entityIds: [...p.entityIds, cardId] } : p,
        ),
      };
    }
  }

  // 重叠自由牌 → 任一方是版图或尺寸不同 → 不自动建堆
  if (target.card) {
    const overlapCard = target.card; // 闭包内窄化不保留，提局部常量
    if (card.kind !== "board" && overlapCard.kind !== "board" && sameSize(overlapCard, card)) {
      // 堆整体归属落点所在宿主实体（坐标换算相对，同自由放置语义）。
      // 排除两张参与建堆的牌：目标牌若躺在其他卡/版图上，宿主判定会命中它自己（zIndex 最高），
      // pile 挂到堆成员牌下 + 其残留相对坐标换系 → 建堆后堆"跑到别处"
      const host = findHostAt(state, x, y, card.size, [cardId, overlapCard.id]);
      const hw = host ? worldOf(state, host) : undefined;
      diagLog("placeAt.decision", { branch: "new-pile", with: overlapCard.id, host: host?.id ?? null });
      const pile: Pile = {
        id: `pile-${Date.now()}`,
        entityIds: [overlapCard.id, cardId],
        x: hw ? x - hw.x : x,
        y: hw ? y - hw.y : y,
        parentId: host?.id,
      };
      return {
        ...state,
        entities: state.entities.map((e) =>
          e.id === overlapCard.id || e.id === cardId ? { ...e, parentId: undefined } : e,
        ),
        piles: [...state.piles, pile],
      };
    }
  }

  // 空处 / 尺寸不同 → 自由坐标，zIndex 置顶。
  // 坐标语义：命中宿主实体（任意 kind）→ parentId 写宿主 + x/y 换算为相对坐标；否则 parentId 清 + x/y 保持世界坐标
  const z = maxZIndex(state) + 1;
  const host = findHostAt(state, x, y, card.size, [card.id]);
  diagLog("placeAt.decision", { branch: "free", host: host?.id ?? null, hostKind: host?.kind ?? null });
  if (host) {
    const hw = worldOf(state, host);
    return {
      ...state,
      entities: state.entities.map((e) =>
        e.id === cardId ? { ...e, x: x - hw.x, y: y - hw.y, zIndex: z, parentId: host.id } : e,
      ),
    };
  }
  return {
    ...state,
    entities: state.entities.map((e) => (e.id === cardId ? { ...e, x, y, zIndex: z, parentId: undefined } : e)),
  };
}

/**
 * 将 cardId 移动到桌面坐标 (x, y)。可来自自由位置 / pile / 手牌区。
 * pile 永不解散（剩 1 张保留）；移空后由 pruneEmptyPiles 清理。
 */
export function moveCard(state: GameState, cardId: string, x: number, y: number): GameState {
  const card = findCard(state, cardId);
  if (!card) return state;
  diagLog("moveCard", {
    cardId,
    kind: card.kind,
    from: { x: card.x, y: card.y, parent: card.parentId ?? null },
    to: { x, y },
  });
  // 版图移动 = 普通移动（x/y 世界坐标）：子实体存相对坐标，无需引擎联动，渲染 DOM 层级天然跟随
  const removed = removeCard(state, cardId);
  return pruneEmptyPiles(placeAt(removed, cardId, x, y));
}

/** 牌加入指定座位的手牌区末尾。seatId 任意（沙盒允许塞进任何座位）。版图不可入手牌 */
export function moveCardToHand(state: GameState, cardId: string, seatId: string): GameState {
  const card = findCard(state, cardId);
  const seat = state.seats.find((s) => s.id === seatId);
  if (!card || !seat) return state;
  if (card.kind === "board") return state; // 版图不入手牌区

  const removed = removeCard(state, cardId);
  return pruneEmptyPiles({
    ...removed,
    // 入手牌区：脱离版图（手牌无桌面坐标）
    entities: removed.entities.map((e) => (e.id === cardId ? { ...e, parentId: undefined } : e)),
    seats: removed.seats.map((s) =>
      s.id === seatId ? { ...s, handZone: { entityIds: [...s.handZone.entityIds, cardId] } } : s,
    ),
  });
}

/** 牌从手牌区移出，放到桌面坐标 (x, y)（含落点重叠处理）。委托 moveCard */
export function moveCardFromHand(state: GameState, cardId: string, x: number, y: number): GameState {
  return moveCard(state, cardId, x, y);
}

/** 牌加入 pile 顶部（可来自自由位置 / 手牌区 / 其他 pile） */
export function moveCardToPile(state: GameState, cardId: string, pileId: string): GameState {
  const card = findCard(state, cardId);
  const pile = state.piles.find((p) => p.id === pileId);
  if (!card || !pile) return state; // 目标堆不存在 = 无操作（空堆已清理，牌走自由放置路径）

  const removed = removeCard(state, cardId);
  return pruneEmptyPiles({
    ...removed,
    // 入堆：牌的归属由堆代表，自身脱离版图
    entities: removed.entities.map((e) => (e.id === cardId ? { ...e, parentId: undefined } : e)),
    piles: removed.piles.map((p) =>
      p.id === pileId ? { ...p, entityIds: [...p.entityIds, cardId] } : p,
    ),
  });
}

/**
 * 牌从 pile 移出，放到桌面坐标 (x, y)。委托 moveCard（pile 永不解散，空堆由 move 动作清理）。
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

/** 座位计分：delta 可正可负（沙盒，不设上下限）。座位不存在 → 原状态。不可变更新 */
export function addScore(state: GameState, seatId: string, delta: number): GameState {
  if (!state.seats.some((s) => s.id === seatId)) return state;
  return {
    ...state,
    seats: state.seats.map((s) => (s.id === seatId ? { ...s, score: s.score + delta } : s)),
  };
}

/**
 * 设置 die 点数（clamp 1..sides）。掷骰 = UI 生成随机数后调用（引擎保持纯函数，
 * 服务端照常权威应用）。实体不存在或非 die → 原状态。不可变更新
 */
export function setDie(state: GameState, entityId: string, value: number): GameState {
  const die = state.entities.find((e) => e.id === entityId);
  if (die?.kind !== "die") return state;
  const clamped = Math.min(die.sides ?? 6, Math.max(1, Math.round(value)));
  return {
    ...state,
    entities: state.entities.map((e) => (e.id === entityId ? { ...e, value: clamped } : e)),
  };
}

/**
 * 移动整个牌堆到桌面坐标 (x, y)（x/y = 堆左上角，世界坐标）。不可变更新。
 * ① 落点命中同尺寸的另一堆 → 合并：源堆牌并入目标堆顶，源堆删除（合并不是解散）
 * ② 落点命中宿主实体 → 跟随（坐标换算相对）
 * ③ 否则自由放置（脱离原归属）
 */
export function movePile(state: GameState, pileId: string, x: number, y: number): GameState {
  const pile = state.piles.find((p) => p.id === pileId);
  if (!pile) return state;
  const first = state.entities.find((e) => e.id === pile.entityIds[0]);
  const fs = first?.size ?? { width: 120, height: 168 };

  // ① 合并判定：源堆中心与目标堆中心距离 < 阈值（源堆尺寸短边/2，上限 OVERLAP_DISTANCE）且尺寸相同
  const scx = x + fs.width / 2;
  const scy = y + fs.height / 2;
  const threshold = Math.min(OVERLAP_DISTANCE, Math.min(fs.width, fs.height) / 2);
  const target = state.piles.find((p) => {
    if (p.id === pileId || p.entityIds.length === 0) return false;
    const targetFirst = state.entities.find((e) => e.id === p.entityIds[0]);
    if (!targetFirst || !first || !sameSize(targetFirst, first)) return false;
    const ts = targetFirst.size ?? { width: 120, height: 168 };
    const pw = worldOf(state, p);
    return distance(scx, scy, pw.x + ts.width / 2, pw.y + ts.height / 2) < threshold;
  });
  diagLog("movePile.decision", { pileId, drop: { x, y }, mergedInto: target?.id ?? null });
  if (target) {
    const movedIds = new Set(pile.entityIds);
    return {
      ...state,
      // 并入目标堆的牌脱离原父归属（位置由目标堆代表）
      entities: state.entities.map((e) => (movedIds.has(e.id) ? { ...e, parentId: undefined } : e)),
      piles: state.piles
        .filter((p) => p.id !== pileId)
        .map((p) => (p.id === target.id ? { ...p, entityIds: [...p.entityIds, ...pile.entityIds] } : p)),
    };
  }

  // ② 落点重判归属（任意实体可做宿主）
  const host = findHostAt(state, x, y, fs);
  diagLog("movePile.decision", { pileId, branch: host ? `host:${host.id}(${host.kind})` : "free", x, y });
  if (host) {
    const hw = worldOf(state, host);
    return {
      ...state,
      piles: state.piles.map((p) =>
        p.id === pileId ? { ...p, x: x - hw.x, y: y - hw.y, parentId: host.id } : p,
      ),
    };
  }
  return {
    ...state,
    piles: state.piles.map((p) => (p.id === pileId ? { ...p, x, y, parentId: undefined } : p)),
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

/** 翻整叠：pile 内所有卡 faceUp 取反（token/board 单面不动，与 flipCard 拦截一致） */
export function flipPile(state: GameState, pileId: string): GameState {
  const pile = state.piles.find((p) => p.id === pileId);
  if (!pile || pile.entityIds.length === 0) return state;
  const flipSet = new Set(pile.entityIds);
  return {
    ...state,
    entities: state.entities.map((e) =>
      flipSet.has(e.id) && e.kind === "card" ? { ...e, faceUp: !e.faceUp } : e,
    ),
  };
}

/** 翻转双面 token（TTS tile 正/背面，如说明书第 1/2 页）。单面 token 忽略。不可变更新 */
export function flipToken(state: GameState, entityId: string): GameState {
  const index = state.entities.findIndex((e) => e.id === entityId);
  if (index === -1) return state;
  const token = state.entities[index];
  if (token.kind !== "token") return state; // 仅 token 可经此翻面（是否有背面由 UI/资产层把关）
  return {
    ...state,
    entities: [
      ...state.entities.slice(0, index),
      { ...token, faceUp: !token.faceUp },
      ...state.entities.slice(index + 1),
    ],
  };
}

/**
 * 顺时针旋转 90°（仅版图生效；卡牌/Token 忽略）。不可变更新。
 * 只改 rotation；尺寸保持原始（渲染/计算处按 rotation 分支取有效尺寸，见 Card 的 boardRotated）。
 * 旋转不带动其上实体（牌保持绝对坐标），但重判归属：中心仍在旋转后矩形内的保留 parentId，脱离的清掉（防下次移动粘连）
 */
export function rotateEntity(state: GameState, entityId: string): GameState {
  const index = state.entities.findIndex((e) => e.id === entityId);
  if (index === -1) return state;
  const entity = state.entities[index];
  if (entity.kind !== "board") return state; // 仅版图可旋转
  const next = ((entity.rotation + 90) % 360) as Rotation;
  const rotated = { ...entity, rotation: next };

  const s = effectiveSize(rotated);
  const rw = worldOf(state, rotated);
  const insideBoard = (wx: number, wy: number) =>
    wx >= rw.x && wx <= rw.x + s.width && wy >= rw.y && wy <= rw.y + s.height;

  const entities = state.entities.map((e) => {
    if (e.id === entityId) return rotated;
    if (e.parentId !== entityId) return e;
    const es = effectiveSize(e);
    const w = worldOf(state, e);
    if (insideBoard(w.x + es.width / 2, w.y + es.height / 2)) return e;
    // 脱离版图：坐标换算回世界（相对坐标 + 父链）
    return { ...e, parentId: undefined, x: w.x, y: w.y };
  });
  const piles = state.piles.map((p) => {
    if (p.parentId !== entityId) return p;
    const first = state.entities.find((e) => e.id === p.entityIds[0]);
    const ps = first?.size ?? { width: 120, height: 168 };
    const w = worldOf(state, p);
    if (insideBoard(w.x + ps.width / 2, w.y + ps.height / 2)) return p;
    return { ...p, parentId: undefined, x: w.x, y: w.y };
  });

  return { ...state, entities, piles };
}

/**
 * 删除实体（Lab 本地编辑用，**不进动作注册表/协议**）：
 * 从容器（piles/handZones）移除 + 从实体列表删除实例；空堆由 pruneEmptyPiles 清理。
 * 实体不存在 → 原状态。不可变更新。
 */
export function removeEntity(state: GameState, entityId: string): GameState {
  const exists = state.entities.some((e) => e.id === entityId);
  if (!exists) return state;
  const removed = removeCard(state, entityId);
  // 删除宿主实体：子实体/子堆恢复自由（坐标换算回世界；更深层的孙实体归属不变，随中间层保留）
  const entities = removed.entities
    .filter((e) => e.id !== entityId)
    .map((e) => {
      if (e.parentId !== entityId) return e;
      const w = worldOf(removed, e);
      return { ...e, parentId: undefined, x: w.x, y: w.y };
    });
  const piles = removed.piles.map((p) => {
    if (p.parentId !== entityId) return p;
    const w = worldOf(removed, p);
    return { ...p, parentId: undefined, x: w.x, y: w.y };
  });
  return pruneEmptyPiles({ ...removed, entities, piles });
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
      return drop ? { ...e, ...drop, parentId: undefined } : e; // 掉落即自由，脱离版图
    }),
    seats: state.seats.map((s) =>
      s.id === seatId ? { ...s, handZone: { entityIds: [] } } : s,
    ),
  };
}
