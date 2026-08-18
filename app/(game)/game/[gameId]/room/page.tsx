"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStatus, onStatusChange } from "@/lib/multiplayer/connection";
import { send, onMessage } from "@/lib/multiplayer/transport";
import { sessionStore } from "@/lib/multiplayer/session";
import { buildGame } from "@/lib/engine/build-game";
import type { ServerMessage } from "@/lib/multiplayer/protocol";

export default function RoomCreatePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = use(params);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const playerId = localStorage.getItem("bg_player_id") || crypto.randomUUID();
    const playerName = localStorage.getItem("bg_player_name") || "";

    if (!localStorage.getItem("bg_player_id")) {
      localStorage.setItem("bg_player_id", playerId);
    }

    const unsubMsg = onMessage((msg: ServerMessage) => {
      if (msg.type === "room_created") {
        // 创建者客户端初始化游戏状态：buildGame（自己视口居中）→ 存 session → update_game_state
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
        router.replace(`/room/${msg.code}`);
      } else if (msg.type === "error") {
        setError(msg.message);
      }
    });

    // 开房只引用 gameId，服务端从桌游库取定义
    function doCreate() {
      send({ type: "create_room", playerId, playerName, gameId });
    }

    if (getStatus() === "connected") {
      doCreate();
    } else {
      const unsubConn = onStatusChange((status) => {
        if (status === "connected") {
          unsubConn();
          doCreate();
        }
      });
      return () => {
        unsubConn();
        unsubMsg();
      };
    }

    return () => unsubMsg();
  }, [gameId, router]);

  return (
    <main className="p-8 flex items-center justify-center min-h-[60vh]">
      {error ? (
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <Link href="/games" className="link-pop text-sm">
            ← 返回游戏广场
          </Link>
        </div>
      ) : (
        <p className="text-muted text-lg">创建房间中...</p>
      )}
    </main>
  );
}
