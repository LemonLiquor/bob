"use client";

import CardBack from "@/components/game/CardBack";
import type { Sprite } from "@/lib/engine/types";
import type { Deck } from "@/lib/pnp/crop";

// ============================================================
// 实体组区 — 建组 / 选背面提示条 / 卡行（正背缩略图、替换、删除）
// ============================================================

/** 图片选择模式：新建实体组选背面 / 替换单个正背面 */
export type Picker =
  | { type: "back"; deckIdx: number }
  | { type: "replace"; deckIdx: number; cardIdx: number; face: "front" | "back" }
  | null;

interface DeckBuilderProps {
  decks: Deck[];
  sprites: Sprite[];
  picker: Picker;
  selectedCount: number;
  onAddDeck: () => void;
  onAutoPair: () => void;
  onRemoveCard: (deckIdx: number, cardIdx: number) => void;
  onRemoveDeck: (deckIdx: number) => void;
  onSetPicker: (picker: Picker) => void;
  onSameFaces: (deckIdx: number) => void; // 正反面一样（back = 各自正面图）
}

export default function DeckBuilder({
  decks, sprites, picker, selectedCount,
  onAddDeck, onAutoPair, onRemoveCard, onRemoveDeck, onSetPicker, onSameFaces,
}: DeckBuilderProps) {
  const spriteUrl = (id: string): string | undefined => sprites.find((s) => s.id === id)?.url;

  const isPicking = (di: number, ci: number, face: "front" | "back"): boolean =>
    picker?.type === "replace" && picker.deckIdx === di && picker.cardIdx === ci && picker.face === face;

  return (
    <div className="border-2 border-ink p-3 mt-3">
      <div className="flex items-center gap-3 mb-2">
        <p className="text-sm font-medium">
          实体组（{decks.length} 组，共 {decks.reduce((n, d) => n + d.cards.length, 0)} 个）
        </p>
        <button
          className="btn-ghost text-xs"
          onClick={onAutoPair}
          disabled={sprites.length === 0}
          title="勾选页按顺序两两配对：正面=前页切图，背面=后页镜像图"
        >
          自动正反交替组卡
        </button>
        <button className="btn-pop text-sm" onClick={onAddDeck} disabled={selectedCount === 0}>
          + 新建实体组（{selectedCount} 个）
        </button>
      </div>

      {picker && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1 bg-yellow-200/70 border-2 border-ink text-xs">
          <span>
            {picker.type === "back"
              ? `为「实体组 ${picker.deckIdx + 1}」选择背面：点击图片池图片设为共用背面`
              : `替换「实体组 ${picker.deckIdx + 1}」第 ${picker.cardIdx + 1} 个的${picker.face === "front" ? "正面" : "背面"}：点击图片池图片`}
          </span>
          {picker.type === "back" && (
            <button className="link-pop text-[11px]" onClick={() => onSameFaces(picker.deckIdx)}>
              正反面一样
            </button>
          )}
          {picker.type === "back" && (
            <button className="link-pop text-[11px]" onClick={() => onSetPicker(null)}>
              跳过（默认卡背）
            </button>
          )}
          <button className="link-pop text-[11px]" onClick={() => onSetPicker(null)}>
            取消
          </button>
        </div>
      )}

      {decks.length === 0 ? (
        <p className="text-[11px] text-muted">先在图片池选中图片，再点「新建实体组」</p>
      ) : (
        decks.map((deck, di) => (
          <div key={di} className="border-2 border-ink p-2 mb-2 bg-card">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">实体组 {di + 1}（{deck.cards.length} 个）</span>
              <button className="link-pop text-[11px] text-red-500" onClick={() => onRemoveDeck(di)}>
                删除实体组
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {deck.cards.map((card, ci) => (
                <div key={ci} className="flex items-center gap-2 border border-ink/40 p-1">
                  <button
                    className={`relative w-10 h-14 border-2 overflow-hidden bg-[#1e3a5f] ${isPicking(di, ci, "front") ? "animate-pulse border-red-500" : "border-transparent hover:border-secondary"}`}
                    onClick={() => onSetPicker({ type: "replace", deckIdx: di, cardIdx: ci, face: "front" })}
                    title="点击替换正面"
                  >
                    <img src={spriteUrl(card.frontSpriteId)} alt="正面" className="w-full h-full object-cover" />
                  </button>
                  <button
                    className={`relative w-10 h-14 border-2 overflow-hidden bg-[#1e3a5f] ${isPicking(di, ci, "back") ? "animate-pulse border-red-500" : "border-transparent hover:border-secondary"}`}
                    onClick={() => onSetPicker({ type: "replace", deckIdx: di, cardIdx: ci, face: "back" })}
                    title="点击替换背面"
                  >
                    {card.backSpriteId ? (
                      <img src={spriteUrl(card.backSpriteId)} alt="背面" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <CardBack />
                      </div>
                    )}
                  </button>
                  <span className="text-[10px] font-mono text-secondary flex-1">
                    {card.frontSpriteId} / {card.backSpriteId || "默认卡背"}
                  </span>
                  <button className="link-pop text-[11px] text-red-500" onClick={() => onRemoveCard(di, ci)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
