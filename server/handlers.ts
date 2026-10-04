import { WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "../lib/multiplayer/protocol";
import { RoomManager } from "./room-manager";
import type { GameLibrary } from "./game-library";
import { applyAction } from "../lib/engine";

// ============================================================
// 消息分发 — 解析客户端消息，调用 RoomManager 并回复/广播
// ============================================================

function send(ws: WebSocket, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

function broadcast(room: { players: Map<WebSocket, unknown> }, msg: ServerMessage, exclude?: WebSocket): void {
  for (const ws of room.players.keys()) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}

export function handleMessage(
  ws: WebSocket,
  data: WebSocket.RawData,
  roomManager: RoomManager,
  gameLibrary: GameLibrary,
): void {
  let parsed: ClientMessage;
  try {
    parsed = JSON.parse(data.toString()) as ClientMessage;
  } catch {
    send(ws, { type: "error", message: "invalid json" });
    return;
  }

  switch (parsed.type) {
    case "create_room": {
      const room = roomManager.createRoom(ws, parsed.playerId, parsed.playerName, parsed.gameId);
      if (!room) {
        send(ws, { type: "error", message: "该游戏未上传到桌游库" });
        return;
      }
      const def = gameLibrary.getGame(room.gameId ?? "");
      // 下发资产 + 无座存档 initialState（重新开始用）+ 补座后的服务端初始状态（显示用）
      send(ws, {
        type: "room_created",
        code: room.code,
        playerId: parsed.playerId,
        creatorId: room.creatorId,
        players: roomManager.getPlayers(room),
        assets: def?.assets ?? { sprites: [], prefabs: [] },
        initialState: def ? structuredClone(def.initialState) : { entities: [], piles: [], seats: [] },
        gameState: structuredClone(room.gameState),
      });
      break;
    }

    case "join_room": {
      const isReconnect = roomManager.isPlayerInRoom(parsed.code, parsed.playerId);
      const room = roomManager.joinRoom(parsed.code, ws, parsed.playerId, parsed.playerName);
      if (!room) {
        send(ws, { type: "error", message: roomManager.isRoomFull(parsed.code) ? "房间已满" : "房间不存在" });
        return;
      }
      // 进房一次性下发卡牌资产 + 初始状态（重连场景同样覆盖）
      const def = gameLibrary.getGame(room.gameId ?? "");
      send(ws, {
        type: "room_joined",
        code: room.code,
        playerId: parsed.playerId,
        creatorId: room.creatorId,
        players: roomManager.getPlayers(room),
        gameState: room.gameState,
        assets: def?.assets ?? { sprites: [], prefabs: [] },
        initialState: def ? structuredClone(def.initialState) : { entities: [], piles: [], seats: [] },
      });
      if (!isReconnect) {
        broadcast(room, {
          type: "player_joined",
          player: { id: parsed.playerId, name: parsed.playerName },
          seats: room.gameState.seats,
        }, ws);
      }
      break;
    }

    case "game_action": {
      const state = roomManager.getGameState(ws);
      if (!state) {
        send(ws, { type: "error", message: "不在房间中" });
        return;
      }

      let newState = state;
      const { action } = parsed;
      // 动作注册表统一分发（与客户端共用一份 reducer），服务端顺序应用即权威
      newState = applyAction(state, action);

      if (newState !== state) {
        roomManager.updateGameState(ws, newState);
        const room = roomManager.findRoom(ws)!;
        broadcast(room, { type: "state_sync", state: newState });
      }
      break;
    }

    case "update_game_state": {
      // 仅房主可整包替换（重新开始）：防止任意玩家覆盖全房间状态
      const room = roomManager.findRoom(ws);
      const player = room ? room.players.get(ws) : undefined;
      if (!room || !player || player.id !== room.creatorId) {
        send(ws, { type: "error", message: "仅房主可重置游戏状态" });
        return;
      }
      roomManager.updateGameState(ws, parsed.state);
      broadcast(room, { type: "state_sync", state: parsed.state });
      break;
    }

    case "occupy_seat": {
      const player = roomManager.getPlayer(ws);
      if (!player) {
        send(ws, { type: "error", message: "不在房间中" });
        return;
      }
      const state = roomManager.occupySeat(ws, player.id, player.name, parsed.seatId);
      if (!state) {
        send(ws, { type: "error", message: "占座失败" });
        return;
      }
      const room = roomManager.findRoom(ws)!;
      broadcast(room, { type: "state_sync", state });
      break;
    }

    case "vacate_seat": {
      const state = roomManager.vacateSeat(ws);
      if (!state) {
        send(ws, { type: "error", message: "不在房间中" });
        return;
      }
      const room = roomManager.findRoom(ws)!;
      broadcast(room, { type: "state_sync", state });
      break;
    }

    case "upload_game": {
      const now = Date.now();
      const ok = gameLibrary.saveGame({
        meta: parsed.meta,
        assets: parsed.assets,
        initialState: parsed.initialState,
        createdAt: now,
        updatedAt: now,
      });
      if (!ok) {
        send(ws, { type: "error", message: "桌游已存在，不允许覆盖——请重命名或另存为新桌游" });
        return;
      }
      send(ws, { type: "game_uploaded", gameId: parsed.meta.id });
      break;
    }

    case "list_games": {
      send(ws, { type: "game_list", games: gameLibrary.listGames() });
      break;
    }

    case "get_game": {
      const saved = gameLibrary.getGame(parsed.gameId);
      if (!saved) {
        send(ws, { type: "error", message: "该游戏不存在于桌游库" });
        return;
      }
      // 下发资产 + 无座 initialState：客户端直接用（Lab 已摆好坐标）
      send(ws, {
        type: "game_data",
        gameId: saved.meta.id,
        assets: saved.assets,
        initialState: structuredClone(saved.initialState),
      });
      break;
    }

    case "list_rooms": {
      send(ws, { type: "room_list", rooms: roomManager.listRooms() });
      break;
    }

    case "leave_room": {
      const result = roomManager.leaveRoom(ws);
      if (result) {
        const remaining = roomManager.getPlayers(result.room);
        broadcast(result.room, {
          type: "player_left",
          playerId: result.playerId,
          players: remaining,
          seats: result.state.seats,
        });
        // 手牌掉落等状态变更，同步给剩余玩家
        broadcast(result.room, { type: "state_sync", state: result.state });
      }
      break;
    }

    default:
      send(ws, { type: "error", message: `unknown message type` });
  }
}
