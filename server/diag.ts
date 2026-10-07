import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { setDiagSink } from "../lib/diagnostics/log";

// ============================================================
// 服务端诊断日志 — game_action / 引擎决策追加写文件（落点 bug 排查期设施）
// 路径：server/data/logs/server.log（.gitignore 已覆盖 server/data/，不入库）
// 超 2MB 滚动为 server.log.1；写失败静默（日志不影响主流程）
// ============================================================

const LOG_DIR = path.join(process.cwd(), "server", "data", "logs");
const LOG_FILE = path.join(LOG_DIR, "server.log");
const MAX_LOG_BYTES = 2 * 1024 * 1024;

function writeLine(line: string): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    try {
      if (statSync(LOG_FILE).size > MAX_LOG_BYTES) renameSync(LOG_FILE, `${LOG_FILE}.1`);
    } catch {
      /* 文件不存在 = 首次写入 */
    }
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* ignore */
  }
}

/** 业务侧记录：tag + 结构化数据 */
export function serverDiag(tag: string, data: unknown): void {
  writeLine(`[${tag}] ${JSON.stringify(data)}`);
}

/** 引擎 diagLog 的落盘 sink（custom-server 启动时注入）：line 已序列化 */
export function attachEngineDiagSink(): void {
  setDiagSink((line) => writeLine(`[engine] ${line}`));
}
