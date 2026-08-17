"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getStatus, onStatusChange } from "@/lib/multiplayer/connection";
import { send, onMessage } from "@/lib/multiplayer/transport";
import { sessionStore } from "@/lib/multiplayer/session";
import { buildGame } from "@/lib/engine/build-game";
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
        // 创建者客户端初始化游戏状态（视口居中）→ 存 session → update_game_state
        const gameState = buildGame(msg.assets, {
          width: window.innerWidth,
          height: window.innerHeight,
        });
        sessionStore.set({
          code: msg.code,
          playerId: msg.playerId,
          creatorId: msg.creatorId,
          players: msg.players,
          gameState,
          assets: msg.assets,
        });
        send({ type: "update_game_state", state: gameState });
        setCreating(false);
        router.push(`/room/${msg.code}`);
      } else if (msg.type === "room_joined") {
        sessionStore.set({
          code: msg.code,
          playerId: msg.playerId,
          creatorId: msg.creatorId,
          players: msg.players,
          gameState: msg.gameState,
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
        <p className="text-[#999] text-lg">创建房间中...</p>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h2 className="text-xl font-bold mb-6">游戏广场</h2>

      <div className="flex flex-wrap gap-4">
        {/* 加入房间入口 — 第一张卡片 */}
        <JoinRoomCard />

        {/* 游戏列表（服务端桌游库） */}
        {games.map((game) => (
          <div
            key={game.id}
            className="bg-white rounded-lg p-4 shadow-sm border border-[#eee] min-w-[180px] flex flex-col gap-3"
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl">{game.icon}</span>
              <span className="font-medium">{game.name}</span>
            </div>
            <div className="flex gap-1.5">
              <button
                className="text-[11px] text-blue-500 hover:text-blue-700 cursor-pointer"
                onClick={() => handlePlay(game.id)}
              >
                [试玩]
              </button>
              <button
                className="text-[11px] text-green-600 hover:text-green-800 cursor-pointer"
                onClick={() => handleCreateRoom(game.id)}
              >
                [开房间]
              </button>
            </div>
          </div>
        ))}

        {/* 导入入口 → 独立导入页（多页正反交替 PDF） */}
        <button
          className="bg-white rounded-lg p-4 shadow-sm border-2 border-dashed border-[#ccc] min-w-[180px] flex flex-col items-center justify-center gap-2 text-[#999] hover:border-blue-400 hover:text-blue-500 cursor-pointer"
          onClick={() => router.push("/import")}
        >
          <span className="text-2xl">+</span>
          <span className="text-sm">导入 PDF 桌游</span>
        </button>
      </div>

      {games.length === 0 && (
        <p className="text-sm text-[#999] border-2 border-dashed border-[#eee] rounded-lg p-6 text-center mt-4">
          游戏列表为空，先导入一个 PDF 桌游吧
        </p>
      )}
    </main>
  );
}
