"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import GameBoard from "@/components/game/GameBoard";
import GameControlPanel from "@/components/game/GameControlPanel";
import { getStatus, onStatusChange } from "@/lib/multiplayer/connection";
import { send, onMessage } from "@/lib/multiplayer/transport";
import { setAssets } from "@/lib/assets/cache";
import { buildGame } from "@/lib/engine/build-game";
import type { GameAssets } from "@/lib/engine/types";
import type { GameState } from "@/lib/engine";
import type { ServerMessage } from "@/lib/multiplayer/protocol";

// ============================================================
// 单人试玩 — 从服务端桌游库拉取资产（get_game），客户端 buildGame（视口居中）
// ESC 控制面板：重新开始（本地重挂载）/ 返回广场
// ============================================================

export default function GamePlayPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = use(params);
  const router = useRouter();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const assetsRef = useRef<GameAssets>({ sprites: [], prefabs: [] });

  const fetchGame = useCallback(() => {
    send({ type: "get_game", gameId });
  }, [gameId]);

  useEffect(() => {
    const unsub = onMessage((msg: ServerMessage) => {
      if (msg.type === "game_data" && msg.gameId === gameId) {
        // 卡牌资产一次性入缓存；初始状态由客户端 buildGame（视口居中）
        setAssets(msg.assets);
        assetsRef.current = msg.assets;
        setGameState(buildGame(msg.assets, { width: window.innerWidth, height: window.innerHeight }));
        setLoading(false);
      } else if (msg.type === "error") {
        setNotFound(true);
        setLoading(false);
      }
    });

    if (getStatus() === "connected") {
      fetchGame();
    } else {
      const unsubConn = onStatusChange((status) => {
        if (status === "connected") {
          unsubConn();
          fetchGame();
        }
      });
      return () => {
        unsubConn();
        unsub();
      };
    }

    return unsub;
  }, [fetchGame, gameId]);

  // ESC 面板：重新开始 = 重新 buildGame（当前视口居中）+ key 重挂载 GameBoard
  const handleRestart = useCallback(() => {
    setGameState(buildGame(assetsRef.current, { width: window.innerWidth, height: window.innerHeight }));
    setResetKey((k) => k + 1);
  }, []);

  const handleExit = useCallback(() => {
    router.push("/games");
  }, [router]);

  if (notFound) {
    return (
      <main className="p-8 text-center">
        <p className="text-muted mb-4">游戏不存在或未上传</p>
        <Link href="/games" className="link-pop text-sm">
          ← 返回游戏广场
        </Link>
      </main>
    );
  }

  if (loading || !gameState) {
    return (
      <main className="p-8 flex items-center justify-center min-h-[60vh]">
        <p className="text-muted text-lg">加载中...</p>
      </main>
    );
  }

  return (
    <>
      {/* 全屏模式无 nav，悬浮返回入口（参考原 nav 白底风格） */}
      <Link
        href="/games"
        className="btn-ghost fixed top-3 left-3 z-50 px-3 py-1.5 text-sm"
      >
        ← 返回广场
      </Link>
      <GameBoard key={`${gameId}-${resetKey}`} initialState={gameState} />
      <GameControlPanel onRestart={handleRestart} onExit={handleExit} exitLabel="返回广场" />
    </>
  );
}
