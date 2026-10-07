"use client";

import { useState, useEffect } from "react";
import { send, onMessage } from "@/lib/multiplayer/transport";
import { onStatusChange } from "@/lib/multiplayer/connection";
import { sessionStore } from "@/lib/multiplayer/session";
import type { ServerMessage, PlayerInfo } from "@/lib/multiplayer/protocol";
import type { Seat } from "@/lib/engine";

// ============================================================
// RoomPanel — 在线玩家 + 座位列表（离开入口在 ESC 控制面板）
// session 在进入房间时写入 store；code/playerId 会话期内恒定，
// 渲染期快照一次（不用 ref——渲染期访问 ref 是反模式且被 lint 禁止）
// ============================================================

export default function RoomPanel() {
  const [session] = useState(() => sessionStore.get());
  const code = session?.code ?? "";
  const playerId = session?.playerId ?? "";
  const [players, setPlayers] = useState<PlayerInfo[]>(() => session?.players ?? []);
  const [seats, setSeats] = useState<Seat[]>(() => session?.gameState.seats ?? []);

  // 断线重连：重发 join_room（connection 层驱动状态，重连成功后回房间）
  useEffect(() => {
    let wasDisconnected = false;
    const unsub = onStatusChange((status) => {
      if (status === "disconnected" || status === "reconnecting") {
        wasDisconnected = true;
      } else if (status === "connected" && wasDisconnected) {
        wasDisconnected = false;
        if (code && playerId) {
          const playerName = localStorage.getItem("bg_player_name") || "";
          send({ type: "join_room", code, playerId, playerName });
        }
      }
    });
    return unsub;
  }, [code, playerId]);

  useEffect(() => {
    const unsub = onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case "player_joined":
          setPlayers((prev) => {
            if (prev.some((p) => p.id === msg.player.id)) return prev;
            return [...prev, msg.player];
          });
          setSeats(msg.seats);
          break;
        case "player_left":
          setPlayers(msg.players);
          setSeats(msg.seats);
          break;
        case "room_joined":
          setPlayers(msg.players);
          setSeats(msg.gameState.seats);
          sessionStore.set({
            code: msg.code,
            playerId: msg.playerId,
            creatorId: msg.creatorId,
            players: msg.players,
            gameState: msg.gameState,
            initialState: msg.initialState,
            assets: msg.assets,
          });
          break;
        case "state_sync":
          setSeats(msg.state.seats);
          break;
      }
    });
    return unsub;
  }, []);

  function handleOccupy(seatId: string) {
    send({ type: "occupy_seat", seatId });
  }

  function handleVacate() {
    send({ type: "vacate_seat" });
  }

  if (!code) return null;

  return (
    <div className="panel-pop fixed top-3 right-3 z-50 p-3 min-w-[240px]">
      {/* sidebar-panel h3 风格：标题下方 2px 黑色横线 */}
      <p className="text-sm font-mono text-secondary mb-2 pb-2 border-b-2 border-ink">房间: {code}</p>

      <p className="text-[10px] text-muted mt-1 mb-0.5">座位</p>
      <ul>
        {seats.map((seat) => {
          const isMe = seat.playerId === playerId;
          const occupied = !!seat.playerId;
          return (
            <li key={seat.id} className="text-sm py-0.5">
              <div className="flex justify-between items-center">
                <span className={isMe ? "font-bold" : ""}>
                  {seat.label} {occupied ? `👤 ${seat.playerName}` : "[空位]"}
                </span>
                {isMe && (
                  <button className="link-pop text-[11px] text-red-500" onClick={handleVacate}>离座</button>
                )}
                {!isMe && !occupied && (
                  <button className="link-pop text-[11px]" onClick={() => handleOccupy(seat.id)}>入座</button>
                )}
              </div>
              {/* 计分：沙盒语义——任何玩家可给任何座位加减（引擎 add_score 支持负 delta） */}
              {occupied && (
                <div className="flex justify-between items-center mt-0.5">
                  <span className="text-[11px] font-mono text-secondary">分 {seat.score}</span>
                  <div className="flex gap-1">
                    {[1, 5, 10, -1, -5, -10].map((d) => (
                      <button
                        key={d}
                        className={`text-[10px] leading-none px-1 py-1 border border-ink rounded bg-card hover:bg-secondary/30 active:translate-y-px ${d < 0 ? "text-red-500" : ""}`}
                        onClick={() => send({ type: "game_action", action: { type: "add_score", seatId: seat.id, delta: d } })}
                      >
                        {d > 0 ? `+${d}` : d}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-[10px] text-muted mt-2 mb-0.5">在线</p>
      <ul>
        {players.map((p) => (
          <li key={p.id} className="text-sm py-0.5">
            🟢 {p.name}{p.id === playerId ? "（自己）" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
