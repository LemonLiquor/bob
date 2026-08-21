"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { send, onMessage } from "@/lib/multiplayer/transport";
import { sessionStore } from "@/lib/multiplayer/session";
import { setAssets } from "@/lib/assets/cache";
import type { GameAction, ServerMessage } from "@/lib/multiplayer/protocol";
import type { GameState } from "@/lib/engine";
import GameBoard from "@/components/game/GameBoard";
import GameControlPanel from "@/components/game/GameControlPanel";
import RoomPanel from "@/components/room/RoomPanel";

// ============================================================
// 多人游戏房间 — 服务端 GameState 受控模式
// 资产 + 初始状态随 room_created / room_joined 一次性下发（进房加载一次），
// 初始状态 = 桌游存档的无座 initialState（坐标由导入 Lab 摆好，
// 服务端 createRoom 时补 1 个默认空座），客户端直接用，不再 buildGame。
// 之后的 state_sync 只带轻量状态，不重复传图。
// ============================================================

export default function RoomPage() {
  const router = useRouter();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [isCreator, setIsCreator] = useState(false);
  const initialStateRef = useRef<GameState | null>(null); // 无座存档版（重新开始用）

  // 挂载时从 sessionStore 取初始状态（含资产），并监听 state_sync
  useEffect(() => {
    const session = sessionStore.get();
    if (!session) {
      router.replace("/games");
      return;
    }

    // 资产一次性入缓存 → 直接渲染服务端初始状态（无座 + 默认空座）
    setAssets(session.assets);
    setGameState(session.gameState);
    setRoomCode(session.code);
    setIsCreator(session.creatorId === session.playerId);
    initialStateRef.current = session.initialState;

    const unsub = onMessage((msg: ServerMessage) => {
      if (msg.type === "state_sync") {
        setGameState(msg.state);
      } else if (msg.type === "room_joined") {
        // 断线重连：资产重新填充 + 状态更新 + 存档版 initialState 刷新
        setAssets(msg.assets);
        setGameState(msg.gameState);
        initialStateRef.current = msg.initialState;
      }
    });
    return unsub;
  }, [router]);

  // 用户操作 → 发送到服务器
  const handleAction = useCallback((action: GameAction) => {
    send({ type: "game_action", action });
  }, []);

  // ESC 面板：重新开始（仅房主）→ 回无座 initialState（坐标原样），
  // 座位保留实例与归属、仅清空手牌（玩家无需重新占座）→ 广播
  const handleRestart = useCallback(() => {
    const init = initialStateRef.current;
    if (!init) return;
    const state: GameState = {
      ...init,
      seats: (gameState?.seats ?? []).map((s) => ({ ...s, handZone: { entityIds: [] } })),
    };
    send({ type: "update_game_state", state });
  }, [gameState]);

  // ESC 面板：退出房间
  const handleExit = useCallback(() => {
    send({ type: "leave_room" });
    sessionStore.clear();
    router.push("/");
  }, [router]);

  if (!gameState) return null;

  return (
    <>
      <RoomPanel />
      <GameBoard gameState={gameState} onAction={handleAction} />
      <GameControlPanel
        roomCode={roomCode}
        isCreator={isCreator}
        onRestart={handleRestart}
        onExit={handleExit}
        exitLabel="退出房间"
      />
    </>
  );
}
