import type { NextRequest } from "next/server";
import { GameBody, MAX_BODY_BYTES, firstIssue } from "@/lib/bff/schema";
import { fail, ok } from "@/lib/bff/respond";
import { INTERNAL_TOKEN, internalGamesUrl } from "@/lib/bff/internal";

/**
 * 上传桌游：原来浏览器直连 WS 发 upload_game（无校验 / 无体积上限 / 错误只有字符串）。
 * 现在改成 HTTP 进来，由这一层做完三件事再转发给游戏服。
 *
 * 顺序不是随手排的：
 *   先量体积 → 再校验形状 → 最后转发（真正写盘）
 *
 * 不做鉴权的理由：上传是这个项目的过渡态，目标态是桌游留在各自客户端、游玩时才上传，
 * 那时的身份是节点身份而不是会话。现在加 cookie 会话鉴权，最后要拆掉。
 */

/**
 * 流式读 body，边读边累加，超限立刻掐断。
 * 不用 req.text()：那样等于先把 20MB 全读进内存再发现超了，上限形同虚设。
 * 也不用 content-length 头：客户端可以不带，也可以报假数，只有实际读到的字节算数。
 */
async function readLimited(req: NextRequest, limit: number): Promise<string | null> {
  const stream = req.body;
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel(); // 提前断开，不再继续收
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function POST(req: NextRequest) {
  const raw = await readLimited(req, MAX_BODY_BYTES);
  if (raw === null) {
    return fail("TOO_LARGE", `桌游包超过 ${Math.round(MAX_BODY_BYTES / 1024 / 1024)}MB 上限`);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("INVALID_BODY", "请求体不是合法 JSON");
  }

  const parsed = GameBody.safeParse(body);
  if (!parsed.success) {
    return fail("INVALID_BODY", firstIssue(parsed.error));
  }

  // 转发：上游就是同进程的 index.ts（持有唯一的 GameLibrary 实例）
  let upstream: Response;
  try {
    upstream = await fetch(internalGamesUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": INTERNAL_TOKEN,
      },
      body: JSON.stringify(parsed.data),
    });
  } catch {
    return fail("UPSTREAM_FAILED", "游戏服未响应");
  }

  if (upstream.status === 409) {
    return fail("GAME_EXISTS", "该桌游已存在，请重命名后重试");
  }
  if (!upstream.ok) {
    return fail("UPSTREAM_FAILED", `游戏服返回 ${upstream.status}`);
  }

  const { gameId } = (await upstream.json()) as { gameId: string };
  return ok({ gameId });
}
