export const STACK_OFFSET = 0.5;
export const SPREAD_GAP = 8;

/** 卡牌尺寸（与 Card.tsx 渲染尺寸一致） */
export const CARD_WIDTH = 120;
export const CARD_HEIGHT = 168;

/** 重叠判定阈值：两张牌中心距小于该值视为重叠 */
export const OVERLAP_DISTANCE = 30;

/** 桌面中心（dropHandToTable 掉落点基准） */
export const TABLE_CENTER = { x: 400, y: 300 };

export interface CardOffset {
  offsetX: number;
  offsetY: number;
}

/** stack: 计算偏移，每张向右下偏移 STACK_OFFSET */
export function stackLayout(count: number): CardOffset[] {
  return Array.from({ length: count }, (_, i) => ({
    offsetX: i * STACK_OFFSET,
    offsetY: i * STACK_OFFSET,
  }));
}

/** spread: 水平等间距平铺，全部可见 */
export function spreadLayout(count: number): CardOffset[] {
  return Array.from({ length: count }, (_, i) => ({
    offsetX: i * SPREAD_GAP,
    offsetY: 0,
  }));
}
