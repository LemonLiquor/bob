import http from "node:http";
import next from "next";
import { createGameWss, isWsPath } from "./game-ws";
import { attachEngineDiagSink } from "./diag";

/**
 * 统一端口服务（custom server）：一个进程一个端口同时服务
 * - HTTP 请求 → Next（页面 + 静态资源）
 * - /ws upgrade → 游戏服 ws
 * - 其余 upgrade（/_next/webpack-hmr 等）→ 交还 Next（dev 热更新）
 *
 * dev：  npm run dev           （tsx server/custom-server.ts）
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

const wss = createGameWss();

async function main() {
  await app.prepare();
  // handle / upgradeHandler 必须在 prepare() 之后获取
  const handle = app.getRequestHandler();
  const upgradeHandler = app.getUpgradeHandler();

  const server = http.createServer((req, res) => handle(req, res));

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
