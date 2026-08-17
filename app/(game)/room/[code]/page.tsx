"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { send, onMessage } from "@/lib/multiplayer/transport";
import { sessionStore } from "@/lib/multiplayer/session";
import { setAssets } from "@/lib/assets/cache";
import { buildGame } from "@/lib/engine/build-game";
import type { GameAction, ServerMessage } from "@/lib/multiplayer/protocol";
import type { CardAsset, GameState } from "@/lib/engine";
import GameBoard from "@/components/game/GameBoard";
import GameControlPanel from "@/components/game/GameControlPanel";
import RoomPanel from "@/components/room/RoomPanel";

// ============================================================
// 多人游戏房间 — 服务端 GameState 受控模式
// 资产随 room_created / room_joined 一次性下发（进房加载一次），
// 之后的 state_sync 只带轻量状态（imageId 引用），不重复传图
// 初始状态由创建者客户端 buildGame（视口居中）后 update_game_state 写入
// ============================================================

export default function RoomPage() {
  const router = useRouter();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [isCreator, setIsCreator] = useState(false);
  const assetsRef = useRef<{ assets: CardAsset[]; creatorId: string; playerId: string } | null>(null);

  // 挂载时从 sessionStore 取初始状态（含资产），并监听 state_sync
  useEffect(() => {
    const session = sessionStore.get();
    if (!session) {
      router.replace("/games");
      return;
    }

    // 卡牌资产一次性入缓存 → 直接渲染
    setAssets(session.assets);
    setGameState(session.gameState);
    setRoomCode(session.code);
    setIsCreator(session.creatorId === session.playerId);
    assetsRef.current = {
      assets: session.assets,
      creatorId: session.creatorId,
      playerId: session.playerId,
    };

    const unsub = onMessage((msg: ServerMessage) => {
      if (msg.type === "state_sync") {
        setGameState(msg.state);
      } else if (msg.type === "room_joined") {
        // 断线重连：资产重新填充 + 状态更新
        setAssets(msg.assets);
        // 竞态兜底：创建者尚未 update_game_state 时服务端是空占位 state，
        // 本地 buildGame 兜底显示（不发送，等创建者广播修正）
        const isEmpty =
          msg.gameState.cards.length === 0 &&
          msg.gameState.piles.length === 0 &&
          msg.gameState.seats.length === 0;
        setGameState(isEmpty ? buildGame(msg.assets, { width: window.innerWidth, height: window.innerHeight }) : msg.gameState);
      }
    });
    return unsub;
  }, [router]);

  // 用户操作 → 发送到服务器
  const handleAction = useCallback((action: GameAction) => {
    send({ type: "game_action", action });
  }, []);

  // ESC 面板：重新开始（仅房主）→ 重新 buildGame（当前视口居中）→ 广播
  const handleRestart = useCallback(() => {
    const ref = assetsRef.current;
    if (!ref) return;
    const state = buildGame(ref.assets, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    send({ type: "update_game_state", state });
  }, []);

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
