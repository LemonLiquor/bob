import http from "node:http";
import next from "next";
import { createGameWss, isWsPath } from "./game-ws";
import { attachEngineDiagSink } from "./diag";
import { GameLibrary } from "./game-library";
import { createInternalHandler, isInternalPath } from "./internal-api";

/**
 * 统一端口服务：一个进程一个端口同时服务
 * - HTTP 请求 → Next（页面 + 静态资源）
 * - /ws upgrade → 游戏服 ws
 * - 其余 upgrade（/_next/webpack-hmr 等）→ 交还 Next（dev 热更新）
 *
 * dev：  npm run dev           （tsx server/index.ts）
 * lan：  npm run dev:lan       （--host 0.0.0.0）
 * prod： npm start             （--prod，需先 next build）
 */
const args = process.argv.slice(2);
const dev = !args.includes("--prod");
const PORT = Number(process.env.PORT ?? 3000);
const hostIdx = args.indexOf("--host");
const HOST = hostIdx >= 0 ? args[hostIdx + 1] : "localhost";

// 引擎 diagLog（多人权威模式在服务端执行）→ server/data/logs/server.log
attachEngineDiagSink();

const app = next({ dev, turbopack: dev });

// 桌游库唯一实例：ws 消息与 /internal/games 必须共用它
const gameLibrary = new GameLibrary();
gameLibrary.loadAll();

const wss = createGameWss(gameLibrary);
const handleInternal = createInternalHandler(gameLibrary);

async function main() {
  await app.prepare();
  // handle / upgradeHandler 必须在 prepare() 之后获取
  const handle = app.getRequestHandler();
  const upgradeHandler = app.getUpgradeHandler();

  const server = http.createServer((req, res) => {
    // BFF 的 Route Handler 打进来的内部上游接口，不经过 Next 路由表
    if (isInternalPath(req.url)) {
      void handleInternal(req, res);
      return;
    }
    handle(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    if (isWsPath(req.url)) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else {
      upgradeHandler(req, socket, head);
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[server] http+ws on http://${HOST}:${PORT} (dev=${dev})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
