// ============================================================
// 共享消息协议 — 客户端和服务端共用
// ============================================================

import type { CardAsset, GameState, Seat } from "../engine/types";

// --- Game Actions ---

export type GameAction =
  | { type: "move_card"; cardId: string; x: number; y: number }
  | { type: "move_to_hand"; cardId: string; seatId: string } // seatId 任意（沙盒）
  | { type: "flip_card"; cardId: string }
  | { type: "shuffle_pile"; pileId: string };

// --- Client → Server ---

/** 上传的桌游元数据（卡牌资产单独在 assets 数组） */
export type UploadGameMeta = { id: string; name: string; icon: string };

/** 桌游库条目（列表用） */
export type GameInfo = { id: string; name: string; icon: string };

export type ClientMessage =
  | { type: "create_room"; playerId: string; playerName: string; gameId: string }
  | { type: "join_room"; code: string; playerId: string; playerName: string }
  | { type: "leave_room" }
  | { type: "list_rooms" }
  | { type: "upload_game"; meta: UploadGameMeta; assets: CardAsset[] }
  | { type: "list_games" }
  | { type: "get_game"; gameId: string }
  | { type: "game_action"; action: GameAction }
  | { type: "update_game_state"; state: GameState } // 仅房主：整包替换（重新开始等）
  | { type: "occupy_seat"; seatId: string }
  | { type: "vacate_seat" };

// --- Server → Client ---

export type PlayerInfo = { id: string; name: string };

/** 房间概要信息（房间列表用） */
export type RoomInfo = {
  code: string;
  gameId?: string;
  gameName: string;
  icon: string;
  playerCount: number;
  maxSeats: number;
};

export type ServerMessage =
  | { type: "room_list"; rooms: RoomInfo[] }
  | { type: "game_uploaded"; gameId: string }
  | { type: "game_list"; games: GameInfo[] }
  // 客户端负责 buildGame（含居中），room_created 不再携带 initialState
  | { type: "game_data"; gameId: string; assets: CardAsset[] }
  | { type: "room_created"; code: string; playerId: string; creatorId: string; players: PlayerInfo[]; assets: CardAsset[] }
  | { type: "room_joined"; code: string; playerId: string; creatorId: string; players: PlayerInfo[]; gameState: GameState; assets: CardAsset[] }
  | { type: "player_joined"; player: PlayerInfo; seats: Seat[] }
  | { type: "player_left"; playerId: string; players: PlayerInfo[]; seats: Seat[] }
  | { type: "state_sync"; state: GameState }
  | { type: "error"; message: string };
