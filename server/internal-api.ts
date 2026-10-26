import type { IncomingMessage, ServerResponse } from "node:http";
import { INTERNAL_GAMES_PATH, INTERNAL_TOKEN } from "../lib/bff/internal";
import type { GameLibrary, SavedGame } from "./game-library";

/**
 * 进程内上游接口：只给 BFF 的 Route Handler 用，浏览器不应该直接打得通。
 *
 * 存在的唯一理由：index.ts 里那一个 GameLibrary 实例是桌游库的唯一事实来源
 * （内存 Map + server/data/games 下的文件），Route Handler 拿不到同一个实例，只能通过这里转一手。
 */

export function isInternalPath(url: string | undefined): boolean {
  return (url ?? "").split("?")[0] === INTERNAL_GAMES_PATH;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

/** 逐块读完请求体（Node 的 req 是流，不能假设一次读完） */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

export function createInternalHandler(gameLibrary: GameLibrary) {
  return async function handleInternal(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      json(res, 405, { code: "METHOD_NOT_ALLOWED", message: "只接受 POST" });
      return;
    }

    // 一道薄锁：挡住浏览器直接访问 /internal/*。
    // 它能挡的是「误打成公开接口」，挡不住同机进程——那是部署边界该解决的事。
    if (req.headers["x-internal-token"] !== INTERNAL_TOKEN) {
      json(res, 401, { code: "UNAUTHORIZED", message: "内部接口" });
      return;
    }

    let body: Pick<SavedGame, "meta" | "assets" | "initialState">;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { code: "INVALID_JSON", message: "请求体不是合法 JSON" });
      return;
    }

    const now = Date.now();
    const saved = gameLibrary.saveGame({ ...body, createdAt: now, updatedAt: now });

    if (!saved) {
      json(res, 409, { code: "GAME_EXISTS", message: "该桌游已存在" });
      return;
    }

    json(res, 200, { gameId: body.meta.id });
  };
}
