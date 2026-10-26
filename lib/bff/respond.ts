import { NextResponse } from "next/server";

/**
 * 统一响应与错误码。
 *
 * 为什么不让 Route 里随手 return：前端要按「错在哪一类」做不同处理
 * （409 提示重命名、413 提示压缩图片），靠 message 文案判断等于把中文当成接口契约，
 * 改一个字前端就断。
 *
 * 没有 UNAUTHENTICATED：这个项目的上传是过渡态（目标态是桌游留在各自客户端、游玩时才上传），
 * 身份属于节点层而非会话层，做 cookie 会话鉴权最后要删，所以不做。
 */

export type ErrorCode = "INVALID_BODY" | "GAME_EXISTS" | "TOO_LARGE" | "UPSTREAM_FAILED";

/** 错误码 → HTTP 状态码 */
const STATUS: Record<ErrorCode, number> = {
  INVALID_BODY: 400,
  GAME_EXISTS: 409,
  TOO_LARGE: 413,
  UPSTREAM_FAILED: 500,
};

export function fail(code: ErrorCode, message: string) {
  return NextResponse.json({ ok: false, code, message }, { status: STATUS[code] });
}

export function ok<T extends object>(data: T) {
  return NextResponse.json({ ok: true, ...data });
}
