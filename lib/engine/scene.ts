import type { EntityState, GameState, Pile } from "./types";
import { worldOf } from "./actions";

// ============================================================
// 场景派生层 — 一个纯函数把 GameState 推导成"每个实体的世界坐标 + 渲染 z"。
// 渲染层只消费 Scene，不再各自推导——位置/z 序/跟随/成员资格的不变量集中在此。
// （架构目标态"引擎输出场景描述"的第一块；虚拟化/裁剪将来在此地基上做）
// ============================================================

/** 拖拽上下文（纯数据，无 DOM）：activeId = 被拖实体 id；整堆拖拽时为 "pile-move-<id>" */
export interface DragContext {
  activeId: string | null;
  delta: { x: number; y: number }; // 视口像素累计位移
  zoom: number;
}

/** 被拖者及其后代抬到该档位，保证恒在所有未拖实体之上（远高于常规 zIndex） */
export const DRAG_BASE = 100000;

export interface SceneEntity {
  id: string;
  kind: EntityState["kind"];
  x: number; // 世界坐标（含祖先链求和 + 被拖子树 delta/zoom）
  y: number;
  z: number; // 渲染 z（父子链严格递增；被拖者及后代 = DRAG_BASE + 常规 z）
  dragging: boolean; // 是否被拖者本尊
  parentId?: string;
  entity: EntityState; // 原始引用（faceUp/rotation/prefabId/size 等渲染所需）
}

export interface ScenePile {
  id: string;
  x: number;
  y: number;
  z: number;
  dragging: boolean; // 整堆拖拽中
  pile: Pile; // 原始引用（entityIds 从下到上）
}

export interface Scene {
  entities: SceneEntity[]; // 平铺实体（不含 pile 成员与手牌实体——其位置由堆/座位代表）
  piles: ScenePile[];
}

/**
 * 派生场景。不变量（全部在此定义，勿在渲染层复刻）：
 * 1. 位置 = worldOf（parentId 链求和，环保护）+ 被拖子树 delta/zoom
 * 2. z = max(自身原始 z, 父渲染 z + 1)——宿主移动刷新自身 z=maxZ+1 后，
 *    后代恒在所有祖先图面之上（用父的渲染 z 而非原始 z，防打平）
 * 3. 成员资格：pile 成员与手牌实体不入平铺层
 * 4. 跟随：拖任意实体（任意 kind）时其整棵子树同步 delta；整堆拖拽时成员随堆容器
 */
export function deriveScene(state: GameState, drag: DragContext): Scene {
  const inContainer = new Set<string>();
  for (const p of state.piles) for (const id of p.entityIds) inContainer.add(id);
  for (const s of state.seats) for (const id of s.handZone.entityIds) inContainer.add(id);

  // parentId 链是否经过 ancestor（环保护）
  const chainHas = (startPid: string | undefined, ancestorId: string): boolean => {
    let pid = startPid;
    const seen = new Set<string>();
    while (pid && !seen.has(pid)) {
      if (pid === ancestorId) return true;
      seen.add(pid);
      pid = state.entities.find((e) => e.id === pid)?.parentId;
    }
    return false;
  };

  const draggingId = drag.activeId ?? "";
  const isEntityDrag = draggingId !== "" && !draggingId.startsWith("pile-move-");

  // 渲染 z（按实体 id memo 的递归；进行中集合防坏链成环爆栈）
  const zCache = new Map<string, number>();
  const zInProgress = new Set<string>();
  const renderedZ = (e: EntityState): number => {
    const cached = zCache.get(e.id);
    if (cached !== undefined) return cached;
    if (zInProgress.has(e.id)) return e.zIndex; // 环退路：退回原始 z（坏数据不应存在，仅防挂死）
    zInProgress.add(e.id);
    let z = e.zIndex;
    if (e.parentId) {
      const p = state.entities.find((x) => x.id === e.parentId);
      if (p) z = Math.max(z, renderedZ(p) + 1);
    }
    zInProgress.delete(e.id);
    zCache.set(e.id, z);
    return z;
  };

  const entities: SceneEntity[] = [];
  for (const e of state.entities) {
    if (inContainer.has(e.id)) continue;
    const w = worldOf(state, e);
    const follow = isEntityDrag && e.id !== draggingId && chainHas(e.parentId, draggingId);
    const baseZ = renderedZ(e);
    entities.push({
      id: e.id,
      kind: e.kind,
      x: w.x + (follow ? drag.delta.x / drag.zoom : 0),
      y: w.y + (follow ? drag.delta.y / drag.zoom : 0),
      z: e.id === draggingId || follow ? DRAG_BASE + baseZ : baseZ,
      dragging: e.id === draggingId,
      parentId: e.parentId,
      entity: e,
    });
  }

  const piles: ScenePile[] = [];
  for (const p of state.piles) {
    const w = worldOf(state, p);
    const follow = isEntityDrag && chainHas(p.parentId, draggingId);
    const members = p.entityIds
      .map((id) => state.entities.find((e) => e.id === id))
      .filter((e): e is EntityState => e !== undefined);
    const topZ = members.reduce((m, c) => Math.max(m, c.zIndex), 0);
    // 堆 z = max(堆内最高实体 z, 父渲染 z + 1)——父链抬升同样适用
    const parentEnt = p.parentId ? state.entities.find((x) => x.id === p.parentId) : undefined;
    const parentZ = parentEnt ? renderedZ(parentEnt) : -1;
    const baseZ = Math.max(topZ, parentZ + 1);
    const selfDragging = draggingId === `pile-move-${p.id}`;
    const memberDragging = members.some((c) => c.id === draggingId);
    piles.push({
      id: p.id,
      x: w.x + (follow ? drag.delta.x / drag.zoom : 0),
      y: w.y + (follow ? drag.delta.y / drag.zoom : 0),
      z: selfDragging || memberDragging || follow ? DRAG_BASE + baseZ : baseZ,
      dragging: selfDragging,
      pile: p,
    });
  }

  return { entities, piles };
}
