"use client";

import { useEffect, useState } from "react";
import { send, onMessage } from "@/lib/multiplayer/transport";
import type { GameInfo } from "@/lib/multiplayer/protocol";

// ============================================================
// ImportGameModal — 导入现有桌游弹窗（在现有桌游基础上修改）
// 挂载时拉取桌游库列表；点桌游 → 两段确认（替换当前工作区）→ onPick(gameId, name)
// 数据获取（get_game → game_data）由 lab 页面处理，与上传链路同构
// ============================================================

interface ImportGameModalProps {
  onClose: () => void;
  onPick: (gameId: string, name: string) => void;
}

export default function ImportGameModal({ onClose, onPick }: ImportGameModalProps) {
  const [games, setGames] = useState<GameInfo[]>([]);
  const [confirming, setConfirming] = useState<GameInfo | null>(null);

  // 拉取桌游库列表（挂载时）
  useEffect(() => {
    send({ type: "list_games" });
    const unsub = onMessage((msg) => {
      if (msg.type === "game_list") setGames(msg.games);
    });
    return unsub;
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-card border-2 border-ink p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-1">导入现有桌游</h3>
        <p className="text-xs text-secondary mb-4">在现有桌游基础上修改，上传后将覆盖原桌游</p>

        {confirming ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              导入《{confirming.icon} {confirming.name}》将替换当前工作区（现有 PDF 实体与草稿清除），确定？
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost text-sm" onClick={() => setConfirming(null)}>
                取消
              </button>
              <button className="btn-pop text-sm" onClick={() => onPick(confirming.id, confirming.name)}>
                确认导入
              </button>
            </div>
          </div>
        ) : games.length === 0 ? (
          <p className="text-sm text-muted py-4">桌游库为空，先用 [导入 PDF] 组装并上传一个桌游</p>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto">
            {games.map((game) => (
              <button
                key={game.id}
                className="btn-ghost w-full text-sm flex items-center gap-2 justify-start"
                onClick={() => setConfirming(game)}
              >
                <span className="text-xl">{game.icon}</span>
                <span>{game.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
