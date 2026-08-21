import type { PlayerInfo, RoomInfo } from "../lib/multiplayer/protocol";
import type { WebSocket } from "ws";
import type { GameState } from "../lib/engine/types";
import { createSeat } from "../lib/engine/demo-data";
import { dropHandToTable } from "../lib/engine/actions";
import type { GameLibrary } from "./game-library";

// ============================================================
// RoomManager — 房间创建、加入、离开、清理
// ============================================================

/** 座位上限 */
const MAX_SEATS = 6;

interface Room {
  code: string;
  players: Map<WebSocket, PlayerInfo>;
  gameState: GameState;
  creatorId: string; // 房主：唯一可 update_game_state（重新开始）
  gameId?: string;
  gameName?: string;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();

  constructor(private gameLibrary: GameLibrary) {}

  private generateCode(): string {
    let code: string;
    do {
      code = String(Math.floor(1000 + Math.random() * 9000));
    } while (this.rooms.has(code));
    return code;
  }

  /** 创建房间。房主不自动入座（须手动 occupy_seat）。
   *  初始状态直接取桌游存档的无座 initialState（坐标由导入页 Lab 自定义），
   *  并补 1 个默认空座（复用 createSeat），创建者可立即落座；
   *  深拷贝防多房间共享引用。 */
  createRoom(ws: WebSocket, playerId: string, playerName: string, gameId: string): Room | null {
    const def = this.gameLibrary.getGame(gameId);
    if (!def) return null;

    const code = this.generateCode();
    const player: PlayerInfo = { id: playerId, name: playerName };

    const room: Room = {
      code,
      players: new Map([[ws, player]]),
      gameState: { ...structuredClone(def.initialState), seats: [createSeat()] },
      creatorId: playerId,
      gameId: def.meta.id,
      gameName: def.meta.name,
    };
    this.rooms.set(code, room);
    console.log(`[ws] room created: ${code} by ${playerName} (game: ${gameId})`);
    return room;
  }

  /** 加入房间。重连不重复创建；座位数未达上限时新建空座位 */
  joinRoom(code: string, ws: WebSocket, playerId: string, playerName: string): Room | null {
    const room = this.rooms.get(code);
    if (!room) return null;

    const existing = this.findPlayerInRoom(room, playerId);
    if (existing) {
      room.players.delete(existing.ws);
      room.players.set(ws, existing.info);
      console.log(`[ws] ${playerName} reconnected to room ${code}`);
      return room;
    }

    // 满员拒绝新玩家
    if (room.players.size >= MAX_SEATS) return null;

    const player: PlayerInfo = { id: playerId, name: playerName };
    room.players.set(ws, player);

    // 新玩家 → 座位不够且未达上限时才新建空座位
    if (room.gameState.seats.length < room.players.size && room.gameState.seats.length < MAX_SEATS) {
      room.gameState.seats.push(createSeat());
    }

    console.log(`[ws] ${playerName} joined room ${code}`);
    return room;
  }

  isPlayerInRoom(code: string, playerId: string): boolean {
    const room = this.rooms.get(code);
    if (!room) return false;
    return this.findPlayerInRoom(room, playerId) !== null;
  }

  /** 房间是否已满员 */
  isRoomFull(code: string): boolean {
    const room = this.rooms.get(code);
    return room ? room.players.size >= MAX_SEATS : false;
  }

  private findPlayerInRoom(room: Room, playerId: string): { ws: WebSocket; info: PlayerInfo } | null {
    for (const [ws, info] of room.players) {
      if (info.id === playerId) return { ws, info };
    }
    return null;
  }

  getPlayer(ws: WebSocket): PlayerInfo | null {
    const room = this.findRoom(ws);
    if (!room) return null;
    return room.players.get(ws) ?? null;
  }

  getPlayers(room: Room): PlayerInfo[] {
    return Array.from(room.players.values());
  }

  /** 房间列表（概要信息，用于大厅展示） */
  listRooms(): RoomInfo[] {
    return Array.from(this.rooms.values()).map((room) => ({
      code: room.code,
      gameId: room.gameId,
      gameName: room.gameName ?? "未知游戏",
      icon: this.gameLibrary.getGame(room.gameId ?? "")?.meta.icon ?? "🎲",
      playerCount: room.players.size,
      maxSeats: MAX_SEATS,
    }));
  }

  /**
   * 离开房间。先掉落手牌（dropHandToTable），再删除座位和玩家；房间空则删除。
   * 返回新 state 用于广播。
   */
  leaveRoom(ws: WebSocket): { room: Room; playerId: string; state: GameState } | null {
    for (const room of this.rooms.values()) {
      const player = room.players.get(ws);
      if (player) {
        // 手牌掉落 + 删除该玩家座位
        const state = this.removeSeatOfPlayer(room, player.id);
        room.players.delete(ws);
        console.log(`[ws] ${player.name} left room ${room.code}`);
        if (room.players.size === 0) {
          this.rooms.delete(room.code);
          console.log(`[ws] room ${room.code} deleted (empty)`);
        }
        return { room, playerId: player.id, state };
      }
    }
    return null;
  }

  /** 占领指定空位。返回新 state，null 表示失败 */
  occupySeat(ws: WebSocket, playerId: string, playerName: string, seatId: string): GameState | null {
    const room = this.findRoom(ws);
    if (!room) return null;

    let state = room.gameState;

    // 已在其他座位 → 先释放（手牌掉落）
    const currentSeat = state.seats.find((s) => s.playerId === playerId);
    if (currentSeat) {
      state = dropHandToTable(state, currentSeat.id);
      state = this.clearSeatPlayer(state, currentSeat.id);
    }

    const seat = state.seats.find((s) => s.id === seatId);
    if (!seat) return null;
    if (seat.playerId && seat.playerId !== playerId) return null;

    state = {
      ...state,
      seats: state.seats.map((s) =>
        s.id === seatId
          ? { ...s, playerId, playerName }
          : s,
      ),
    };
    room.gameState = state;
    console.log(`[ws] ${playerName} occupied ${seat.label}`);
    return state;
  }

  /** 离座（不退出房间）。手牌掉落 + 清空归属。返回新 state，null 表示失败 */
  vacateSeat(ws: WebSocket): GameState | null {
    const room = this.findRoom(ws);
    if (!room) return null;

    const playerId = room.players.get(ws)?.id;
    if (!playerId) return null;

    let state = room.gameState;
    const seat = state.seats.find((s) => s.playerId === playerId);
    if (!seat) return null;

    state = dropHandToTable(state, seat.id);
    state = this.clearSeatPlayer(state, seat.id);
    room.gameState = state;
    return state;
  }

  /** 删除玩家座位（手牌已掉落，座位必空，直接删除） */
  private removeSeatOfPlayer(room: Room, playerId: string): GameState {
    let state = room.gameState;
    const seat = state.seats.find((s) => s.playerId === playerId);
    if (seat) {
      state = dropHandToTable(state, seat.id);
      state = { ...state, seats: state.seats.filter((s) => s.id !== seat.id) };
    } else {
      // 玩家未入座 → 移除任意一个空座位
      const emptyIdx = state.seats.findIndex((s) => !s.playerId);
      if (emptyIdx !== -1) {
        state = { ...state, seats: state.seats.filter((_, i) => i !== emptyIdx) };
      }
    }
    room.gameState = state;
    return state;
  }

  /** 清空座位归属（保留座位与手牌区） */
  private clearSeatPlayer(state: GameState, seatId: string): GameState {
    return {
      ...state,
      seats: state.seats.map((s) =>
        s.id === seatId ? { ...s, playerId: undefined, playerName: undefined } : s,
      ),
    };
  }

  getGameState(ws: WebSocket): GameState | null {
    const room = this.findRoom(ws);
    return room ? room.gameState : null;
  }

  updateGameState(ws: WebSocket, newState: GameState): boolean {
    const room = this.findRoom(ws);
    if (!room) return false;
    room.gameState = newState;
    return true;
  }

  findRoom(ws: WebSocket): Room | null {
    for (const room of this.rooms.values()) {
      if (room.players.has(ws)) return room;
    }
    return null;
  }

  findPile(room: Room, pileId: string) {
    return room.gameState.piles.find((p) => p.id === pileId);
  }

  handleDisconnect(ws: WebSocket): void {
    this.leaveRoom(ws);
  }
}
