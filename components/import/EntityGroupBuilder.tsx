"use client";

import CardBack from "@/components/game/CardBack";
import type { Sprite } from "@/lib/engine/types";
import type { EntityGroup } from "@/lib/pnp/crop";

// ============================================================
// 实体组区 — 建组 / 选背面提示条 / 组内项（正背缩略图、替换、删除）
// ============================================================

/** 图片选择模式：新建实体组选背面 / 替换单个正背面 */
export type Picker =
  | { type: "back"; groupIdx: number }
  | { type: "replace"; groupIdx: number; itemIdx: number; face: "front" | "back" }
  | null;

interface EntityGroupBuilderProps {
  groups: EntityGroup[];
  sprites: Sprite[];
  picker: Picker;
  selectedCount: number;
  onAddGroup: () => void;
  onAutoPair: () => void;
  onRemoveItem: (groupIdx: number, itemIdx: number) => void;
  onRemoveGroup: (groupIdx: number) => void;
  onSetPicker: (picker: Picker) => void;
  onSameFaces: (groupIdx: number) => void; // 正反面一样（back = 各自正面图）
}

export default function EntityGroupBuilder({
  groups, sprites, picker, selectedCount,
  onAddGroup, onAutoPair, onRemoveItem, onRemoveGroup, onSetPicker, onSameFaces,
}: EntityGroupBuilderProps) {
  const spriteUrl = (id: string): string | undefined => sprites.find((s) => s.id === id)?.url;

  const isPicking = (gi: number, ii: number, face: "front" | "back"): boolean =>
    picker?.type === "replace" && picker.groupIdx === gi && picker.itemIdx === ii && picker.face === face;

  return (
    <div className="border-2 border-ink p-3 mt-3">
      <div className="flex items-center gap-3 mb-2">
        <p className="text-sm font-medium">
          实体组（{groups.length} 组，共 {groups.reduce((n, g) => n + g.items.length, 0)} 个）
        </p>
        <button
          className="btn-ghost text-xs"
          onClick={onAutoPair}
          disabled={sprites.length === 0}
          title="勾选页按顺序两两配对：正面=前页切图，背面=后页镜像图"
        >
          自动正反交替组卡
        </button>
        <button className="btn-pop text-sm" onClick={onAddGroup} disabled={selectedCount === 0}>
          + 新建实体组（{selectedCount} 个）
        </button>
      </div>

      {picker && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1 bg-yellow-200/70 border-2 border-ink text-xs">
          <span>
            {picker.type === "back"
              ? `为「实体组 ${picker.groupIdx + 1}」选择背面：点击图片池图片设为共用背面`
              : `替换「实体组 ${picker.groupIdx + 1}」第 ${picker.itemIdx + 1} 个的${picker.face === "front" ? "正面" : "背面"}：点击图片池图片`}
          </span>
          {picker.type === "back" && (
            <button className="link-pop text-[11px]" onClick={() => onSameFaces(picker.groupIdx)}>
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

      {groups.length === 0 ? (
        <p className="text-[11px] text-muted">先在图片池选中图片，再点「新建实体组」</p>
      ) : (
        groups.map((group, gi) => (
          <div key={gi} className="border-2 border-ink p-2 mb-2 bg-card">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">实体组 {gi + 1}（{group.items.length} 个）</span>
              <button className="link-pop text-[11px] text-red-500" onClick={() => onRemoveGroup(gi)}>
                删除实体组
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {group.items.map((item, ii) => (
                <div key={ii} className="flex items-center gap-2 border border-ink/40 p-1">
                  <button
                    className={`relative w-10 h-14 border-2 overflow-hidden bg-[#1e3a5f] ${isPicking(gi, ii, "front") ? "animate-pulse border-red-500" : "border-transparent hover:border-secondary"}`}
                    onClick={() => onSetPicker({ type: "replace", groupIdx: gi, itemIdx: ii, face: "front" })}
                    title="点击替换正面"
                  >
                    {spriteUrl(item.frontSpriteId) ? (
                      <img src={spriteUrl(item.frontSpriteId)} alt="正面" className="w-full h-full object-contain" />
                    ) : (
                      <div className="w-full h-full bg-[#1e3a5f]" />
                    )}
                  </button>
                  <button
                    className={`relative w-10 h-14 border-2 overflow-hidden bg-[#1e3a5f] ${isPicking(gi, ii, "back") ? "animate-pulse border-red-500" : "border-transparent hover:border-secondary"}`}
                    onClick={() => onSetPicker({ type: "replace", groupIdx: gi, itemIdx: ii, face: "back" })}
                    title="点击替换背面"
                  >
                    {item.backSpriteId ? (
                      spriteUrl(item.backSpriteId) ? (
                        <img src={spriteUrl(item.backSpriteId)} alt="背面" className="w-full h-full object-contain" />
                      ) : (
                        <div className="w-full h-full bg-[#1e3a5f]" />
                      )
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <CardBack />
                      </div>
                    )}
                  </button>
                  <span className="text-[10px] font-mono text-secondary flex-1">
                    {item.frontSpriteId} / {item.backSpriteId || "默认卡背"}
                  </span>
                  <button className="link-pop text-[11px] text-red-500" onClick={() => onRemoveItem(gi, ii)}>
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
