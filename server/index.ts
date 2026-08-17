import { WebSocketServer } from "ws";
import { RoomManager } from "./room-manager";
import { handleMessage } from "./handlers";
import { GameLibrary } from "./game-library";

const PORT = 3001;

// 桌游库：加载磁盘（只含用户上传的桌游，无内置游戏）
const gameLibrary = new GameLibrary();
gameLibrary.loadAll();

const roomManager = new RoomManager(gameLibrary);

const wss = new WebSocketServer({ port: PORT }, () => {
  console.log(`[ws] listening on :${PORT}`);
});

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
