"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getStatus, onStatusChange } from "@/lib/multiplayer/connection";
import { send, onMessage } from "@/lib/multiplayer/transport";
import { sessionStore } from "@/lib/multiplayer/session";
import type { GameInfo, ServerMessage } from "@/lib/multiplayer/protocol";
import JoinRoomCard from "@/components/lobby/JoinRoomCard";

// ============================================================
// 游戏广场：游戏列表（服务端桌游库）
// 页面加载时拉取列表；每个游戏可试玩（单人）/ 开房间
// ============================================================

export default function GamesPage() {
  const router = useRouter();
  const [games, setGames] = useState<GameInfo[]>([]);
  const [creating, setCreating] = useState(false);

  // 拉取游戏列表（挂载时 + 手动刷新）
  function fetchGames() {
    if (getStatus() === "connected") {
      send({ type: "list_games" });
    } else {
      const unsub = onStatusChange((status) => {
        if (status === "connected") {
          unsub();
          send({ type: "list_games" });
        }
      });
    }
  }

  useEffect(() => {
    fetchGames();
  }, []);

  // 监听服务端消息：建房/加入跳转、桌游库列表
  useEffect(() => {
    const unsub = onMessage((msg: ServerMessage) => {
      if (msg.type === "room_created") {
        // 创建者直接用服务端下发的初始状态（补座版，坐标已由导入 Lab 摆好）
        sessionStore.set({
          code: msg.code,
          playerId: msg.playerId,
          creatorId: msg.creatorId,
          players: msg.players,
          gameState: msg.gameState,
          initialState: msg.initialState,
          assets: msg.assets,
        });
        setCreating(false);
        router.push(`/room/${msg.code}`);
      } else if (msg.type === "room_joined") {
        sessionStore.set({
          code: msg.code,
          playerId: msg.playerId,
          creatorId: msg.creatorId,
          players: msg.players,
          gameState: msg.gameState,
          initialState: msg.initialState,
          assets: msg.assets,
        });
        router.push(`/room/${msg.code}`);
      } else if (msg.type === "error") {
        setCreating(false);
      } else if (msg.type === "game_list") {
        setGames(msg.games);
      } else if (msg.type === "game_uploaded") {
        // 新桌游上传完成 → 刷新列表
        fetchGames();
      }
    });
    return unsub;
  }, [router]);

  function handlePlay(gameId: string) {
    router.push(`/game/${gameId}/play`);
  }

  /** 开房：只引用 gameId，服务端从桌游库取定义 */
  function handleCreateRoom(gameId: string) {
    setCreating(true);
    const playerId = localStorage.getItem("bg_player_id") || crypto.randomUUID();
    const playerName = localStorage.getItem("bg_player_name") || "";

    if (!localStorage.getItem("bg_player_id")) {
      localStorage.setItem("bg_player_id", playerId);
    }

    function doSend() {
      send({ type: "create_room", gameId, playerId, playerName });
    }

    if (getStatus() === "connected") {
      doSend();
    } else {
      const unsub = onStatusChange((status) => {
        if (status === "connected") {
          unsub();
          doSend();
        }
      });
    }
  }

  if (creating) {
    return (
      <main className="p-8 flex items-center justify-center min-h-[60vh]">
        <p className="text-muted text-lg">创建房间中...</p>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h2 className="text-2xl font-bold tracking-tight mb-6">游戏广场</h2>

      <div className="flex flex-wrap gap-4">
        {/* 加入房间入口 — 第一张卡片 */}
        <JoinRoomCard />

        {/* 游戏列表（服务端桌游库） */}
        {games.map((game) => (
          <div
            key={game.id}
            className="card-pop p-4 min-w-[180px] flex flex-col gap-3"
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl">{game.icon}</span>
              <span className="font-medium">{game.name}</span>
            </div>
            <div className="flex gap-1.5">
              <button
                className="link-pop text-[11px]"
                onClick={() => handlePlay(game.id)}
              >
                [试玩]
              </button>
              <button
                className="link-pop text-[11px]"
                onClick={() => handleCreateRoom(game.id)}
              >
                [开房间]
              </button>
            </div>
          </div>
        ))}

        {/* 新建桌游入口 → lab 组装工作台（反复导入多个 PDF 组装为一个桌游） */}
        <button
          className="dashed-zone min-w-[180px] flex flex-col items-center justify-center gap-2 text-muted hover:text-primary cursor-pointer bg-card p-4"
          onClick={() => router.push("/lab")}
        >
          <span className="text-2xl">+</span>
          <span className="text-sm">新建桌游</span>
        </button>
      </div>

      {games.length === 0 && (
        <p className="text-sm text-muted dashed-zone p-6 text-center mt-4 bg-card">
          游戏列表为空，先导入一个 PDF 桌游吧
        </p>
      )}
    </main>
  );
}
