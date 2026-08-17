/**
 * 卡牌资产（静态层：进房时一次性下发，永不参与状态同步）。
 * 一张卡 = 一个对象：id 与 GameState.cards[].id 对应，正反图直接是 dataURL。
 * 渲染：getCardAsset(card.id) → faceUp ? frontUrl : backUrl
 */
export interface CardAsset {
  id: string;        // 卡 id（与 CardState.id 对应）
  frontUrl: string;  // 正面图片 dataURL
  backUrl?: string;  // 背面图片 dataURL，缺省用默认卡背
}

/**
 * 卡牌动态状态（GameState 的一部分，随 state_sync 高频同步）。
 * 纯逻辑状态，不含任何资源引用。
 */
export interface CardState {
  id: string;
  faceUp: boolean;
  x: number;          // 自由像素坐标（桌面坐标系）
  y: number;
  zIndex: number;     // z 序，越大越靠上
}

export interface Pile {
  id: string;          // 自动生成 "pile-{ts}"
  cardIds: string[];   // 从下到上
  x: number;
  y: number;
}

/** 手牌区 — 无坐标：屏幕 UI 组件，不在桌面坐标系 */
export interface HandZone {
  cardIds: string[];
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
  cards: CardState[];
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
  handZone: { cardIds: string[] };
}

