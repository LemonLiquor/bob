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
  // session 在进入房间时写入 store（导航前）；code/isCreator 会话期内恒定 → 快照派生，
  // 不在 mount effect 里同步 setState（react-hooks/set-state-in-effect）
  const [session] = useState(() => sessionStore.get());
  const [gameState, setGameState] = useState<GameState | null>(() => session?.gameState ?? null);
  const roomCode = session?.code ?? "";
  const isCreator = !!session && session.creatorId === session.playerId;
  const initialStateRef = useRef<GameState | null>(session?.initialState ?? null); // 无座存档版（重新开始用）

  // 无 session = 直接刷新了房间 URL → 回广场；否则订阅 state_sync
  useEffect(() => {
    if (!session) {
      router.replace("/games");
      return;
    }
    // 资产一次性入缓存（全局 AssetLibrary，非 React state）→ 直接渲染服务端初始状态
    setAssets(session.assets);
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
  }, [router, session]);

  // 用户操作 → 发送到服务器
  const handleAction = useCallback((action: GameAction) => {
    send({ type: "game_action", action });
  }, []);

  // ESC 面板：重新开始（仅房主）→ 回无座 initialState（坐标原样），
  // 座位保留实例与归属、清空手牌、计分归零（新一局）→ 广播
  const handleRestart = useCallback(() => {
    const init = initialStateRef.current;
    if (!init) return;
    const state: GameState = {
      ...init,
      seats: (gameState?.seats ?? []).map((s) => ({ ...s, score: 0, handZone: { entityIds: [] } })),
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
        presetsEnabled
      />
    </>
  );
}
