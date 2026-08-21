import type { PlayerInfo } from "./protocol";
import type { GameAssets, GameState } from "../engine/types";

// ============================================================
// SessionStore — 房间创建/加入 → 房间页传递初始状态
// room_created / room_joined 消息携带卡牌资产（进房一次性下发）随 session 中转
// ============================================================

interface Session {
  code: string;
  playerId: string;
  creatorId: string; // 房主：ESC 面板重新开始按钮权限
  players: PlayerInfo[];
  gameState: GameState;
  initialState: GameState; // 无座存档版（重新开始用）
  assets: GameAssets;
}

let current: Session | null = null;

export const sessionStore = {
  set(session: Session): void {
    current = session;
  },
  get(): Session | null {
    return current;
  },
  clear(): void {
    current = null;
  },
};
