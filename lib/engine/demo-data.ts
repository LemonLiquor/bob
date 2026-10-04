import type { Seat as SeatType, SeatTemplate } from "./types";

// ============================================================
// 座位模板 — 新建玩家时的默认座位（手牌区无坐标，屏幕 UI 组件）
// ============================================================

/** 默认座位模板：每个玩家一个手牌区（无坐标，屏幕 UI 组件） */
export const DEFAULT_SEAT_TEMPLATE: SeatTemplate = {
  label: "座位",
  handZone: { entityIds: [] },
};

/** 根据模板创建新座位。handZone 无坐标 */
export function createSeatFromTemplate(template: SeatTemplate): SeatType {
  const ts = Date.now();
  return {
    id: `seat-${ts}`,
    index: ts,
    label: template.label,
    score: 0,
    handZone: { entityIds: [...template.handZone.entityIds] },
  };
}

/** 创建新座位（使用默认模板） */
export function createSeat(): SeatType {
  return createSeatFromTemplate(DEFAULT_SEAT_TEMPLATE);
}
