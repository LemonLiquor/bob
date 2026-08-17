import type { CardAsset, CardState, GameState } from "./types";
import { createSeat } from "./demo-data";
import { CARD_WIDTH, CARD_HEIGHT } from "./layout";

// ============================================================
// buildGame — 由卡牌资产派生初始状态（客户端调用）
// - 每张卡一个纯逻辑状态（id 与资产 id 对应，无任何资源/字段概念）
// - 全部进一个公共牌堆 + 一个默认座位
// - boardSize 传入时牌堆居中于桌面（服务端无法感知客户端视口，
//   故移到客户端构建；创建者/单机用自己视口居中，其他玩家用广播的 state）
// ============================================================

export interface BoardSize {
  width: number;
  height: number;
}

export function buildGame(assets: CardAsset[], boardSize?: BoardSize): GameState {
  const cards: CardState[] = assets.map((a) => ({
    id: a.id,
    faceUp: false,
    x: 0,
    y: 0,
    zIndex: 0,
  }));

  const x = boardSize ? Math.max(0, Math.round((boardSize.width - CARD_WIDTH) / 2)) : 0;
  const y = boardSize ? Math.max(0, Math.round((boardSize.height - CARD_HEIGHT) / 2)) : 0;

  return {
    cards,
    piles: [{ id: "pile-牌堆", cardIds: cards.map((c) => c.id), x, y }],
    seats: [createSeat()],
  };
}
