"use client";

import { useState, useEffect, useRef } from "react";
import { send, onMessage } from "@/lib/multiplayer/transport";
import { onStatusChange } from "@/lib/multiplayer/connection";
import { sessionStore } from "@/lib/multiplayer/session";
import type { ServerMessage, PlayerInfo } from "@/lib/multiplayer/protocol";
import type { Seat } from "@/lib/engine";

// ============================================================
// RoomPanel — 在线玩家 + 座位列表（离开入口在 ESC 控制面板）
// ============================================================

export default function RoomPanel() {
  const codeRef = useRef("");
  const playerIdRef = useRef("");
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);

  useEffect(() => {
    const session = sessionStore.get();
    if (!session) return; // room 页面已保证 session 存在（防御性不渲染）
    codeRef.current = session.code;
    playerIdRef.current = session.playerId;
    setPlayers(session.players);
    setSeats(session.gameState.seats);
  }, []);

  useEffect(() => {
    let wasDisconnected = false;
    const unsub = onStatusChange((status) => {
      if (status === "disconnected" || status === "reconnecting") {
        wasDisconnected = true;
      } else if (status === "connected" && wasDisconnected) {
        wasDisconnected = false;
        const code = codeRef.current;
        const playerId = playerIdRef.current;
        if (code && playerId) {
          const playerName = localStorage.getItem("bg_player_name") || "";
          send({ type: "join_room", code, playerId, playerName });
        }
      }
    });
    return unsub;
  }, []);

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

  if (!codeRef.current) return null;

  return (
    <div className="fixed top-3 right-3 z-50 bg-white/90 rounded-lg p-3 shadow-md min-w-[200px]">
      <p className="text-sm font-mono text-[#666] mb-2">房间: {codeRef.current}</p>

      <p className="text-[10px] text-[#999] mt-1 mb-0.5">座位</p>
      <ul>
        {seats.map((seat) => {
          const isMe = seat.playerId === playerIdRef.current;
          const occupied = !!seat.playerId;
          return (
            <li key={seat.id} className="text-sm py-0.5 flex justify-between items-center">
              <span className={isMe ? "font-bold" : ""}>
                {seat.label} {occupied ? `👤 ${seat.playerName}` : "[空位]"}
              </span>
              {isMe && (
                <button className="text-[11px] text-red-500 cursor-pointer" onClick={handleVacate}>离座</button>
              )}
              {!isMe && !occupied && (
                <button className="text-[11px] text-blue-500 cursor-pointer" onClick={() => handleOccupy(seat.id)}>入座</button>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-[10px] text-[#999] mt-2 mb-0.5">在线</p>
      <ul>
        {players.map((p) => (
          <li key={p.id} className="text-sm py-0.5">
            🟢 {p.name}{p.id === playerIdRef.current ? "（自己）" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
