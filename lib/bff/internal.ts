/**
 * BFF ↔ 游戏服的进程内通道约定。
 *
 * 为什么 Route 不能直接 import GameLibrary 来用：
 * Next 的 Route Handler 与 custom-server 是两套模块图，各自会加载一份模块，
 * 于是出现两个 GameLibrary 实例——内存里的 Map 各记一份，
 * 「同 id 已存在就拒绝覆盖」的保护和列表都会错乱。
 * 所以 Route 用 HTTP 打到同进程的 /internal/*，由持有唯一实例的 custom-server 处理。
 */

export const INTERNAL_TOKEN = process.env.BFF_INTERNAL_TOKEN ?? "dev-internal-token";

export const INTERNAL_GAMES_PATH = "/internal/games";

/** 上游地址只在服务端出现，浏览器永远看不到真实端口 */
export function internalGamesUrl(): string {
  const port = process.env.PORT ?? "3000";
  // 用 localhost 而非 127.0.0.1：custom-server 默认只监听 localhost（解析到 ::1），
  // 写死 IPv4 会连不上；--host 0.0.0.0 时 localhost 仍然可达
  return `http://localhost:${port}${INTERNAL_GAMES_PATH}`;
}
