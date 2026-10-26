import { WebSocketServer } from "ws";
import { RoomManager } from "./room-manager";
import { handleMessage } from "./handlers";
import { GameLibrary } from "./game-library";

export const WS_PATH = "/ws";

/**
 * 游戏服 ws 逻辑（noServer 模式）：只负责连接后的消息处理，
 * HTTP server 的 upgrade 路由由宿主决定（index.ts）
 *
 * gameLibrary 可外部注入：index.ts 要把同一个实例同时给 ws 和 /internal/* 用，
 * 两个实例会各记一份内存 Map，导致覆盖保护和列表不一致。
 */
export function createGameWss(lib?: GameLibrary): WebSocketServer {
  const gameLibrary = lib ?? new GameLibrary();
  if (!lib) gameLibrary.loadAll();

  const roomManager = new RoomManager(gameLibrary);

  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    console.log("[ws] client connected");

    ws.on("message", (data) => {
      handleMessage(ws, data, roomManager, gameLibrary);
    });

    ws.on("close", () => {
      roomManager.handleDisconnect(ws);
      console.log("[ws] client disconnected");
    });
  });

  return wss;
}

/** upgrade 路径判定（含查询串容错） */
export function isWsPath(url: string | undefined): boolean {
  try {
    return new URL(url ?? "/", "http://x").pathname === WS_PATH;
  } catch {
    return false;
  }
}
