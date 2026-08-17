// ============================================================
// 卡牌资产缓存 — 内存 Map（进房/试玩时一次性填充，渲染时同步查表）
// 一张卡 = 一个对象（正反图 dataURL 都在里面）。
// 只随 room_created / room_joined / game_data 下发一次，
// 永不参与 state_sync 同步。
// ============================================================

import type { CardAsset } from "../engine";

let cache = new Map<string, CardAsset>();

/** 填充/覆盖资产缓存（进房、重连、试玩时调用） */
export function setAssets(assets: CardAsset[]): void {
  cache = new Map(assets.map((a) => [a.id, a]));
}

/** 按卡 id 取卡牌资产，不存在返回 undefined（渲染回退默认样式） */
export function getCardAsset(id: string): CardAsset | undefined {
  return cache.get(id);
}
