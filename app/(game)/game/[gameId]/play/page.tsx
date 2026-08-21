"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import GameBoard from "@/components/game/GameBoard";
import GameControlPanel from "@/components/game/GameControlPanel";
import { getStatus, onStatusChange } from "@/lib/multiplayer/connection";
import { send, onMessage } from "@/lib/multiplayer/transport";
import { setAssets } from "@/lib/assets/cache";
import type { GameState } from "@/lib/engine";
import type { ServerMessage } from "@/lib/multiplayer/protocol";

// ============================================================
// 单人试玩 — 从服务端桌游库拉取资产与无座 initialState（get_game），
// 直接用（坐标由导入 Lab 摆好）；无座时 GameBoard 自动补虚拟座位
// ESC 控制面板：重新开始（回 initialState）/ 返回广场
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
  const initialStateRef = useRef<GameState | null>(null); // 无座存档版（重新开始用）

  const fetchGame = useCallback(() => {
    send({ type: "get_game", gameId });
  }, [gameId]);

  useEffect(() => {
    const unsub = onMessage((msg: ServerMessage) => {
      if (msg.type === "game_data" && msg.gameId === gameId) {
        // 资产一次性入缓存；初始状态直接用服务端下发的无座 initialState
        setAssets(msg.assets);
        initialStateRef.current = msg.initialState;
        setGameState(msg.initialState);
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

  // ESC 面板：重新开始 = 回无座 initialState（坐标原样）+ key 重挂载 GameBoard
  const handleRestart = useCallback(() => {
    if (!initialStateRef.current) return;
    setGameState(initialStateRef.current);
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
