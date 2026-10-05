// ============================================================
// 共享消息协议 — 客户端和服务端共用
// ============================================================

import type { GameAssets, GameAction, GameState, Seat, GamePreset } from "../engine/types";

export type { GameAction, GamePreset }; // 由 engine/types 定义，此处 re-export 保持 API 不变

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
  | { type: "upload_game"; meta: UploadGameMeta; assets: GameAssets; initialState: GameState }
  | { type: "list_games" }
  | { type: "get_game"; gameId: string }
  | { type: "game_action"; action: GameAction }
  | { type: "update_game_state"; state: GameState } // 仅房主：整包替换（重新开始等）
  | { type: "occupy_seat"; seatId: string }
  | { type: "vacate_seat" }
  | { type: "save_preset"; name: string } // 仅房主：当前桌面存为预设（手牌退回桌面）
  | { type: "load_preset"; presetId: string } // 仅房主：加载预设（保留座位、清手牌、计分归零）
  | { type: "delete_preset"; presetId: string } // 仅房主：删除预设
  | { type: "list_presets" };

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
  // 客户端直接用服务端下发的初始状态（含 Lab 自定义坐标），不再 buildGame
  | { type: "game_data"; gameId: string; assets: GameAssets; initialState: GameState }
  | { type: "room_created"; code: string; playerId: string; creatorId: string; players: PlayerInfo[]; assets: GameAssets; initialState: GameState; gameState: GameState }
  | { type: "room_joined"; code: string; playerId: string; creatorId: string; players: PlayerInfo[]; gameState: GameState; assets: GameAssets; initialState: GameState }
  | { type: "player_joined"; player: PlayerInfo; seats: Seat[] }
  | { type: "player_left"; playerId: string; players: PlayerInfo[]; seats: Seat[] }
  | { type: "state_sync"; state: GameState }
  | { type: "presets_list"; presets: GamePreset[] }
  | { type: "error"; message: string };
