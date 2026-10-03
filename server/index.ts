import http from "node:http";
import { createGameWss, isWsPath } from "./game-ws";

/**
 * 独立 ws 模式（遗留兼容）：前端单独托管 / 调试时用，`npm run dev:ws`。
 * 统一端口方案见 custom-server.ts（ws 与 Next 同端口）。
 */
const PORT = Number(process.env.WS_PORT ?? 3001);

const server = http.createServer((_req, res) => {
  res.writeHead(426).end("Upgrade Required");
});

const wss = createGameWss();

server.on("upgrade", (req, socket, head) => {
  if (isWsPath(req.url)) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`[ws] listening on :${PORT}`);
});
