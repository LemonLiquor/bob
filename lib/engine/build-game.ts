import type { EntityState, GameAssets, GameState } from "./types";
import { createSeat } from "./demo-data";
import { CARD_WIDTH, CARD_HEIGHT } from "./layout";

// ============================================================
// buildGame — 由资产（prefabs）派生初始状态（客户端调用）
// - 每个 prefab 展开一个实例（确定性顺序：prefabs 数组顺序 → inst-0, inst-1, ...）
// - 全部进一个公共牌堆 + 一个默认座位
// - boardSize 传入时牌堆居中于桌面（服务端无法感知客户端视口，
//   故移到客户端构建；创建者/单机用自己视口居中，其他玩家用广播的 state）
// ============================================================

export interface BoardSize {
  width: number;
  height: number;
}

export function buildGame(assets: GameAssets, boardSize?: BoardSize): GameState {
  const entities: EntityState[] = assets.prefabs.map((p, i) => ({
    id: `inst-${i}`,
    prefabId: p.id,
    faceUp: false,
    x: 0,
    y: 0,
    zIndex: 0,
  }));

  const x = boardSize ? Math.max(0, Math.round((boardSize.width - CARD_WIDTH) / 2)) : 0;
  const y = boardSize ? Math.max(0, Math.round((boardSize.height - CARD_HEIGHT) / 2)) : 0;

  return {
    entities,
    piles: [{ id: "pile-牌堆", entityIds: entities.map((e) => e.id), x, y }],
    seats: [createSeat()],
  };
}
