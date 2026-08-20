/**
 * 引擎类型 — 三层结构（资源 / 模板 / 实例）
 * - 资源层（静态）：Sprite（纯图）+ Prefab（模板，faces 引用 sprite），进房时一次性下发，永不参与状态同步
 * - 状态层（动态）：EntityState（实例，引用 prefab），随 state_sync 高频同步
 * - 渲染：getPrefabFaces(entity.prefabId) → [正面url, 背面url] → faceUp ? [0] : [1]
 */

/** 纯图片资源，无任何业务语义 */
export interface Sprite {
  id: string;   // "sprite-f0"
  url: string;  // dataURL
}

/** 实体模板（预制体）：完整定义，自带全部面。引擎式 Prefab，无 kind（类型由内容决定） */
export interface Prefab {
  id: string;          // "prefab-c0"（游戏内唯一）
  faces: {
    front: string;     // 正面 sprite id
    back: string;      // 背面 sprite id（空串 = 无背面，渲染回退默认卡背）
  };
}

/** 桌游资产集合：纯美术资源（图片表 + 模板表） */
export interface GameAssets {
  sprites: Sprite[];
  prefabs: Prefab[];
}

/**
 * 实例（场上实体）：纯逻辑状态，引用 prefab，不含任何资源引用。
 * 渲染：getPrefabFaces(entity.prefabId) → faceUp ? 正面 : 背面
 */
export interface EntityState {
  id: string;         // 实例 id "inst-0"（与 GameState.entities[].id 对应）
  prefabId: string;   // 引用 Prefab.id
  faceUp: boolean;
  x: number;          // 自由像素坐标（桌面坐标系）
  y: number;
  zIndex: number;     // z 序，越大越靠上
}

export interface Pile {
  id: string;          // 自动生成 "pile-{ts}"
  entityIds: string[]; // 从下到上
  x: number;
  y: number;
}

/** 手牌区 — 无坐标：屏幕 UI 组件，不在桌面坐标系 */
export interface HandZone {
  entityIds: string[];
}

export interface Seat {
  id: string;              // "seat-1"
  index: number;           // 创建序号，用于展示
  label: string;           // "座位1"（展示用）
  playerId?: string;       // undefined = 空位
  playerName?: string;     // 与 playerId 配对
  handZone: HandZone;      // 该座位的手牌区
}

export interface GameState {
  entities: EntityState[];
  piles: Pile[];           // 公共牌堆
  seats: Seat[];           // 座位列表
}

export interface GameMeta {
  id: string;              // "pnp-<ts>"
  name: string;            // 游戏名
  icon: string;            // "🖼️"
}

/** 新增玩家时的座位模板。手牌区无坐标（屏幕 UI 组件） */
export interface SeatTemplate {
  label: string;
  handZone: { entityIds: string[] };
}

/** 游戏动作判别联合（传输层 re-export：lib/multiplayer/protocol.ts） */
export type GameAction =
  | { type: "move_card"; cardId: string; x: number; y: number }
  | { type: "move_to_hand"; cardId: string; seatId: string } // seatId 任意（沙盒）
  | { type: "flip_card"; cardId: string }
  | { type: "shuffle_pile"; pileId: string };
