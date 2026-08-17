import type { ClientMessage, ServerMessage } from "./protocol";
import { getSocket, onStatusChange } from "./connection";

// ============================================================
// transport — 类型化消息收发层
// ============================================================

type ServerMessageHandler = (msg: ServerMessage) => void;

const messageListeners: Set<ServerMessageHandler> = new Set();

/** 发送类型化消息到服务器 */
export function send(msg: ClientMessage): void {
  const socket = getSocket();
  if (socket) {
    socket.send(JSON.stringify(msg));
  } else {
    console.warn("[ws] send skipped: not connected");
  }
}

// 当前绑定的 ws.onmessage（用以解绑）
let boundSocket: WebSocket | null = null;

function bindOnMessage(socket: WebSocket): void {
  if (boundSocket === socket) return;
  unbindOnMessage();

  boundSocket = socket;
  socket.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data.toString()) as ServerMessage;
      messageListeners.forEach((fn) => fn(msg));
    } catch {
      // 忽略解析失败的消息
    }
  };
}

function unbindOnMessage(): void {
  if (boundSocket) {
    boundSocket.onmessage = null;
    boundSocket = null;
  }
}

/** 注册消息监听，返回 unsubscribe 函数 */
export function onMessage(fn: ServerMessageHandler): () => void {
  messageListeners.add(fn);

  // 首次注册时，尝试绑定当前活跃的 socket
  const socket = getSocket();
  if (socket) bindOnMessage(socket);

  return () => {
    messageListeners.delete(fn);
  };
}

// 监听连接状态变化：connected 时绑定 onmessage，disconnected 时清理
onStatusChange((status) => {
  if (status === "connected") {
    const socket = getSocket();
    if (socket) bindOnMessage(socket);
  } else if (status === "disconnected") {
    unbindOnMessage();
    messageListeners.clear();
  }
});
