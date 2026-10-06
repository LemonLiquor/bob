/**
 * 引擎类型 — 三层结构（资源 / 模板 / 实例）
 * - 资源层（静态）：Sprite（纯图）+ Prefab（模板，faces 引用 sprite），进房时一次性下发，永不参与状态同步
 * - 状态层（动态）：EntityState（实例，引用 prefab），随 state_sync 高频同步
 * - 渲染：按 prefabId 查 faces（getPrefabFaces）+ kind 决定面选择（token 恒正面）/ 旋转（board）
 */

/** 纯图片资源，无任何业务语义 */
export interface Sprite {
  id: string;   // "sprite-f0"
  url: string;  // dataURL
}

/** 旋转角度（度，顺时针） */
export type Rotation = 0 | 90 | 180 | 270;

/** 实体类型判别：kind 决定能力与 faces 结构，前端按 kind 区别对待（die = 数字面骰/计数器） */
export type EntityKind = "card" | "token" | "board" | "die";

/** 渲染尺寸（桌面 px） */
export type Size = { width: number; height: number };

/**
 * 实体模板（预制体）：判别联合。kind 决定 faces 结构与能力；模板不承担行为字段（无 stackable/singleFace）。
 * - card：可翻（F）、可叠、可洗牌；back 空串 = 渲染回退默认卡背
 * - token：单面（渲染恒正面、禁翻）；可叠
 * - board：单面（渲染恒正面、禁翻）、可旋转（R 顺时针 90°）、不可叠（placeAt 跳过建堆）、不可入手牌
 */
export type Prefab =
  | { kind: "card"; id: string; faces: { front: string; back: string }; size?: Size }
  | { kind: "token"; id: string; faces: { front: string }; size?: Size }
  | { kind: "board"; id: string; faces: { front: string }; size?: Size }
  | { kind: "die"; id: string; sides: number; size?: Size }; // 无图渲染：白底数字面（骰子/计数器）

/** 桌游资产集合：纯美术资源（图片表 + 模板表） */
export interface GameAssets {
  sprites: Sprite[];
  prefabs: Prefab[];
}

/**
 * 实例（场上实体）：kind 判别 + 公共状态字段（faceUp/rotation 带默认值，识别代价低）。
 * - faceUp：仅 card 有效（翻面）；token/board 单面恒正面（渲染按 kind 忽略，flip 按 kind 拦截）
 * - rotation：仅 board 可旋转（客户端按 kind 限制）；渲染 CSS transform，碰撞盒用未旋转尺寸
 * 渲染：getPrefabFaces(entity.prefabId) → [正面url, 背面url] → kind + faceUp 决定显示哪面
 */
export interface EntityState {
  id: string;         // 实例 id "inst-0"（与 GameState.entities[].id 对应）
  prefabId: string;   // 引用 Prefab.id
  kind: EntityKind;   // 从 prefab 复制（构建/迁移时设置）
  faceUp: boolean;    // 默认 false（卡牌背面朝上）；构建时 token/board 可给 true
  rotation: Rotation; // 默认 0；仅 board 可旋转
  value?: number;     // 仅 die：当前点数（1..sides；沙盒任意同步）
  sides?: number;     // 仅 die：面数（构建时从 prefab 复制，同 size 先例）
  x: number;          // 坐标（parentId 非空 = 相对父版图容器；空 = 世界坐标/桌面坐标系）
  y: number;
  zIndex: number;     // z 序，越大越靠上（版图内为容器 SC 内比较）
  parentId?: string;  // 父级实体 id（任意实体可做父：版图/卡牌/token 互为容器）：坐标相对父实体，移动父实体时跟随。undefined = 自由（世界坐标）
  size?: Size;        // 渲染尺寸（从 prefab 复制）；缺省 120×168 卡牌；不同尺寸不可堆叠
}

export interface Pile {
  id: string;          // 自动生成 "pile-{n}"
  entityIds: string[]; // 从下到上
  x: number;
  y: number;
  parentId?: string;   // 所在版图 id：坐标相对该版图容器。undefined = 不在版图上（世界坐标）
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
  score: number;           // 计分（沙盒任意加减，创建时 0；重新开始归零）
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
  | { type: "move_pile"; pileId: string; x: number; y: number } // 整堆移动
  | { type: "move_to_hand"; cardId: string; seatId: string } // seatId 任意（沙盒）
  | { type: "flip_card"; cardId: string }
  | { type: "flip_pile"; pileId: string } // 翻整叠（pile 内 card faceUp 取反；token/board 单面不动）
  | { type: "rotate_entity"; entityId: string } // 顺时针旋转 90°（仅 board 生效）
  | { type: "shuffle_pile"; pileId: string }
  | { type: "add_score"; seatId: string; delta: number } // 座位计分（沙盒任意加减）
  | { type: "set_die"; entityId: string; value: number }; // die 点数（掷骰/±1 由此承载，随机数由 UI 生成）
