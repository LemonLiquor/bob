"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getStatus, onStatusChange } from "@/lib/multiplayer/connection";
import { send, onMessage } from "@/lib/multiplayer/transport";
import type { ClientMessage, RoomInfo, ServerMessage } from "@/lib/multiplayer/protocol";

// ============================================================
// 加入房间卡片 — 游戏列表第一张卡片
// 收起态永远保留（绿色虚线卡片），点击打开弹窗：
// 房间列表（5s 自动刷新）+ 手动输入码；遮罩/ESC/[关闭] 关闭
// ============================================================

export default function JoinRoomCard() {
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomCode, setRoomCode] = useState("");
  const [joiningCode, setJoiningCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const joiningRef = useRef<string | null>(null);

  // 拉取房间列表（未连接则等连接后发送）
  const fetchRooms = useCallback(() => {
    if (getStatus() === "connected") {
      send({ type: "list_rooms" });
    } else {
      const unsub = onStatusChange((status) => {
        if (status === "connected") {
          unsub();
          send({ type: "list_rooms" });
        }
      });
    }
  }, []);

  // 打开时拉取 + 每 5 秒自动刷新
  useEffect(() => {
    if (!open) return;
    fetchRooms();
    const timer = setInterval(fetchRooms, 5000);
    return () => clearInterval(timer);
  }, [open, fetchRooms]);

  // ESC 关闭弹窗
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 监听 room_list 与加入失败
  useEffect(() => {
    const unsub = onMessage((msg: ServerMessage) => {
      if (msg.type === "room_list") {
        setRooms(msg.rooms);
      } else if (msg.type === "error" && joiningRef.current) {
        joiningRef.current = null;
        setJoiningCode(null);
        setError(msg.message);
        setTimeout(() => setError(null), 3000);
      }
    });
    return unsub;
  }, []);

  function doJoin(code: string) {
    const trimmed = code.trim();
    if (!trimmed || joiningRef.current) return;
    setError(null);
    joiningRef.current = trimmed;
    setJoiningCode(trimmed);

    const playerId = localStorage.getItem("bg_player_id") || crypto.randomUUID();
    const playerName = localStorage.getItem("bg_player_name") || "";
    if (!localStorage.getItem("bg_player_id")) {
      localStorage.setItem("bg_player_id", playerId);
    }

    const msg: ClientMessage = { type: "join_room", code: trimmed, playerId, playerName };
    if (getStatus() === "connected") {
      send(msg);
    } else {
      const unsub = onStatusChange((status) => {
        if (status === "connected") {
          unsub();
          send(msg);
        }
      });
    }
  }

  return (
    <>
      {/* 收起态卡片：永远保留在渲染树（弹窗打开时仅被遮罩盖住） */}
      <button
        className="bg-white rounded-lg p-4 shadow-sm border-2 border-dashed border-green-400 min-w-[180px] flex flex-col items-center justify-center gap-1.5 text-green-600 hover:border-green-500 hover:bg-green-50 cursor-pointer"
        onClick={() => setOpen(true)}
      >
        <span className="text-2xl">🚪</span>
        <span className="text-sm font-medium">加入房间</span>
        <span className="text-[11px] text-[#999]">查看开放房间</span>
      </button>

      {/* 弹窗：遮罩 + 居中面板（房间列表 + 输入码） */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
          onClick={() => setOpen(false)}
        >
      <div
        className="bg-white rounded-xl shadow-xl p-6 min-w-[480px] max-w-[560px] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">
            🚪 加入房间 <span className="text-sm text-[#999]">({rooms.length} 个开放房间)</span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              className="text-[11px] text-blue-500 hover:text-blue-700 cursor-pointer"
              onClick={fetchRooms}
            >
              [刷新]
            </button>
            <button
              className="text-[11px] text-[#999] hover:text-[#333] cursor-pointer"
              onClick={() => setOpen(false)}
            >
              [关闭]
            </button>
          </div>
        </div>

        {rooms.length === 0 ? (
          <p className="text-sm text-[#999] text-center py-3">
            暂无开放房间，输入房间码加入或创建一个
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rooms.map((room) => {
              const full = room.playerCount >= room.maxSeats;
              const icon = room.icon || "🎲";
              return (
                <li
                  key={room.code}
                  className="flex items-center gap-3 border border-[#eee] rounded px-3 py-2"
                >
                  <span className="text-lg">{icon}</span>
                  <span className="text-sm flex-1 truncate">{room.gameName}</span>
                  <span className="font-mono text-sm text-[#666]">{room.code}</span>
                  <span className="text-[11px] text-[#999] w-8 text-right">
                    {room.playerCount}/{room.maxSeats}
                  </span>
                  {joiningCode === room.code ? (
                    <span className="text-[11px] text-[#999] w-14 text-right">加入中...</span>
                  ) : (
                    <button
                      className="text-[11px] text-white bg-green-500 rounded px-2 py-0.5 cursor-pointer hover:bg-green-600 disabled:bg-[#ccc] disabled:cursor-not-allowed"
                      disabled={full}
                      onClick={() => doJoin(room.code)}
                    >
                      {full ? "已满" : "加入"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="border-t border-[#eee] mt-3 pt-3 flex items-center gap-2">
          <span className="text-[11px] text-[#999]">有房间码？</span>
          <input
            className="border rounded px-2 py-1 text-sm w-24 focus:outline-none focus:border-green-400"
            placeholder="房间码"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doJoin(roomCode)}
          />
          {joiningCode === roomCode.trim() ? (
            <span className="text-[11px] text-[#999]">加入中...</span>
          ) : (
            <button
              className="bg-green-500 text-white rounded py-1 px-3 text-sm cursor-pointer hover:bg-green-600 disabled:opacity-40"
              disabled={!roomCode.trim()}
              onClick={() => doJoin(roomCode)}
            >
              加入
            </button>
          )}
        </div>

        {error && <p className="text-red-500 text-[11px] mt-2">{error}</p>}
        <p className="text-[11px] text-[#999] mt-2">按 ESC 或点击遮罩关闭</p>
      </div>
        </div>
      )}
    </>
  );
}
