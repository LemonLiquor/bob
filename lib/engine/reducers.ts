// ============================================================
// 动作注册表 — 一份动作分发，GameBoard 与服务端共用（见 docs/architecture.md）
// ============================================================

import type { EntityState, GameAction, GameState } from "./types";
import { moveCard, moveCardToHand, flipCard, flipPile, rotateEntity, shufflePile, movePile, addScore, setDie } from "./actions";

/** 动作分发：纯函数，GameBoard 与服务端共用 */
export function applyAction(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "move_card":
      return moveCard(state, action.cardId, action.x, action.y);
    case "move_pile":
      return movePile(state, action.pileId, action.x, action.y);
    case "move_to_hand":
      return moveCardToHand(state, action.cardId, action.seatId);
    case "flip_card":
      return flipCard(state, action.cardId);
    case "flip_pile":
      return flipPile(state, action.pileId);
    case "rotate_entity":
      return rotateEntity(state, action.entityId);
    case "shuffle_pile":
      return shufflePile(state, action.pileId);
    case "add_score":
      return addScore(state, action.seatId, action.delta);
    case "set_die":
      return setDie(state, action.entityId, action.value);
  }
}

/** 按 id 查实例（保留传入顺序，缺失 id 静默跳过） */
export function findCards(state: GameState, ids: string[]): EntityState[] {
  return ids
    .map((id) => state.entities.find((e) => e.id === id))
    .filter((e): e is EntityState => e !== undefined);
}
