type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";
type StatusListener = (status: ConnectionStatus) => void;

function getWsUrl(): string {
  console.log(`[ws] current hostname: ${window.location.hostname}`);
  if (typeof window === "undefined") return "";

  // 本地开发模式：ws 服务器运行在 :3001（与 Next.js :3000 分离，避免 HMR 冲突）
  return `ws://${window.location.hostname}:3001/ws`;
}

let ws: WebSocket | null = null;
let status: ConnectionStatus = "disconnected";
const listeners: Set<StatusListener> = new Set();

let intentionalClose = false;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(s: ConnectionStatus) {
  if (status !== s) {
    status = s;
    listeners.forEach((fn) => fn(status));
  }
}

function scheduleReconnect(): void {
  if (intentionalClose) return;

  // 指数退避：1s, 2s, 4s, 8s, 16s, 30s (上限)
  const delays = [1000, 2000, 4000, 8000, 16000, 30000];
  const delay = delays[Math.min(reconnectAttempt, delays.length - 1)];

  console.log(`[ws] reconnect attempt ${reconnectAttempt + 1} in ${delay / 1000}s`);
  setStatus("reconnecting");

  reconnectTimer = setTimeout(() => {
    reconnectAttempt++;
    connect();
  }, delay);
}

function cancelReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

export function connect(): void {
  cancelReconnect();
  intentionalClose = false;

  // 已有活跃连接，跳过
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  // 旧连接处于 CLOSING，先清理
  if (ws && ws.readyState === WebSocket.CLOSING) {
    ws.onclose = null;
    ws.onerror = null;
    ws = null;
  }

  setStatus("connecting");
  ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    reconnectAttempt = 0;
    setStatus("connected");
  };

  ws.onclose = () => {
    ws = null;
    if (intentionalClose) {
      setStatus("disconnected");
    } else {
      scheduleReconnect();
    }
  };

  ws.onerror = () => {
    // onclose 会紧随其后触发
  };
}

export function disconnect(): void {
  intentionalClose = true;
  cancelReconnect();
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  setStatus("disconnected");
}

/** 返回当前活跃的 ws 实例（仅 OPEN 状态），供 transport 层使用 */
export function getSocket(): WebSocket | null {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;
  return null;
}

export function getStatus(): ConnectionStatus {
  return status;
}

export function onStatusChange(fn: StatusListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
