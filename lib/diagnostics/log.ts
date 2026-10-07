// ============================================================
// 诊断日志 — 拖拽/落点关键路径埋点（内存环形缓冲，不入存档、不上报）
// 服务端另有 server/data/logs/server.log（server/diag.ts）
// 导出入口：GameControlPanel「导出日志」按钮（下载 + 复制）
// ============================================================

const MAX_ENTRIES = 800;
const buffer: { t: number; tag: string; data: string }[] = [];

// 服务端宿主可注入落盘 sink（custom-server 启动时 setDiagSink）：
// 引擎跑在服务端进程时（多人权威模式），diagLog 同步写 server.log，否则只进内存
let sink: ((line: string) => void) | null = null;

export function setDiagSink(fn: (line: string) => void): void {
  sink = fn;
}

/** 记录一条诊断日志（data 会被 JSON 序列化，循环引用安全） */
export function diagLog(tag: string, data?: unknown): void {
  let text = "";
  if (data !== undefined) {
    try {
      text = JSON.stringify(data);
    } catch {
      text = "[unserializable]";
    }
  }
  buffer.push({ t: Date.now(), tag, data: text });
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  sink?.(text);
}

export function dumpDiagnostics(): string {
  return buffer
    .map((e) => `${new Date(e.t).toISOString()} [${e.tag}] ${e.data}`)
    .join("\n");
}

export function clearDiagnostics(): void {
  buffer.length = 0;
}

/** 浏览器端导出：下载 .log 文件并尝试复制到剪贴板 */
export function downloadDiagnostics(): void {
  const text = dumpDiagnostics();
  const blob = new Blob([text || "(空日志)"], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bob-diag-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
  a.click();
  URL.revokeObjectURL(url);
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}
