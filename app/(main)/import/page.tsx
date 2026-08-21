"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { getPageCount, renderPageToCanvas } from "@/lib/pnp/pdf";
import { cropGrid, DEFAULT_CROP, type CropConfig } from "@/lib/pnp/crop";
import type { Sprite } from "@/lib/engine/types";
import CropInput from "@/components/import/CropInput";
import GridPreview, { type PreviewData } from "@/components/import/GridPreview";
import CardBack from "@/components/game/CardBack";

// ============================================================
// 卡组（页面内临时结构，S4 摊平为 prefabs + piles）
// ============================================================

interface DeckCard {
  frontSpriteId: string;
  backSpriteId: string; // "" = 默认卡背
}

interface Deck {
  cards: DeckCard[];
}

/** 图片选择模式：新建卡组选背面 / 替换单卡正背面 */
type Picker =
  | { type: "back"; deckIdx: number }
  | { type: "replace"; deckIdx: number; cardIdx: number; face: "front" | "back" }
  | null;

// ============================================================
// PnP PDF 导入页（S1：切图 → 图片资源池）
// 选 PDF → 全局切割参数 → 切割全部页 → 图片池（Sprite[]，id sprite-{n} 连续）
// 后续步骤：S2 页面多选 / S3 卡组组装 / S4 上传
// ============================================================

/** 验收打印：url 截断摘要，避免 dataURL 刷屏 */
function logSprites(sprites: Sprite[]): void {
  console.log("sprites:", {
    count: sprites.length,
    list: sprites.map((s) => ({
      id: s.id,
      url: s.url.slice(0, 60) + `…(${s.url.length})`,
    })),
  });
}

/** 验收打印：decks 只含 sprite id 引用 */
function logDecks(decks: Deck[]): void {
  console.log("decks:", {
    count: decks.length,
    list: decks.map((d) => ({
      cards: d.cards.map((c) => ({ front: c.frontSpriteId, back: c.backSpriteId || "默认卡背" })),
    })),
  });
}

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(4);
  const [crop, setCrop] = useState<CropConfig>(DEFAULT_CROP);
  const [sprites, setSprites] = useState<Sprite[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [previews, setPreviews] = useState<(PreviewData | null)[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [picker, setPicker] = useState<Picker>(null);
  const loadToken = useRef(0); // 防止换文件后旧预览乱序覆盖
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadPreview(f: File, page: number): Promise<PreviewData> {
    const canvas = await renderPageToCanvas(f, page);
    return {
      src: canvas.toDataURL("image/jpeg", 0.9),
      width: canvas.width,
      height: canvas.height,
    };
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    if (!f.name.toLowerCase().endsWith(".pdf")) {
      setError("请选择 .pdf 文件");
      return;
    }

    setFile(f);
    setError(null);
    setBusy(true);
    try {
      const count = await getPageCount(f);
      setPageCount(count);
      setSprites([]);
      setSelected(new Set());
      setDecks([]);
      setPicker(null);
      setSelectedPages(new Set(Array.from({ length: count }, (_, i) => i + 1)));
      setPreviews(new Array(count).fill(null));

      // 全部页预览（token 防乱序：换文件后旧异步结果丢弃）
      const token = ++loadToken.current;
      for (let page = 1; page <= count; page++) {
        setProgress(`正在加载预览 第 ${page}/${count} 页...`);
        try {
          const p = await loadPreview(f, page);
          if (loadToken.current !== token) return; // 已换文件，丢弃
          setPreviews((prev) => prev.map((x, i) => (i === page - 1 ? p : x)));
        } catch {
          /* 单页失败不中断 */
        }
      }
    } catch (err) {
      setError(`PDF 解析失败: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  function handleGridChange(kind: "rows" | "cols", value: string) {
    const v = Math.max(1, Math.min(12, Number(value) || 1));
    if (kind === "rows") setRows(v);
    else setCols(v);
  }

  function handleCropChange(kind: keyof CropConfig, value: string) {
    const v = Math.max(0, Math.min(2000, Number(value) || 0));
    setCrop((prev) => ({ ...prev, [kind]: v }));
  }

  /** 切割勾选页 → 图片资源池（sprite id 全局连续） */
  async function handleCrop() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const pages = Array.from(selectedPages).sort((a, b) => a - b);
    const list: Sprite[] = [];
    try {
      for (const page of pages) {
        setProgress(`正在切割第 ${page}/${pageCount} 页（勾选 ${pages.length} 页）...`);
        const canvas = await renderPageToCanvas(file, page);
        const urls = cropGrid(canvas, rows, cols, crop);
        for (const url of urls) {
          list.push({ id: `sprite-${list.length}`, url });
        }
      }
      setSprites(list);
      setSelected(new Set());
      logSprites(list);
    } catch (err) {
      setError(`切割失败: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  /** 点击切换图片选中态 */
  function toggleSprite(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 图片池点击分发：选背面模式 / 替换模式 / 普通选中切换 */
  function handleSpriteClick(id: string) {
    if (picker?.type === "back") {
      // 设为卡组所有卡的共用背面
      const { deckIdx } = picker;
      setDecks((prev) => {
        const next = prev.map((d, i) =>
          i === deckIdx ? { ...d, cards: d.cards.map((c) => ({ ...c, backSpriteId: id })) } : d,
        );
        logDecks(next);
        return next;
      });
      setPicker(null);
      return;
    }
    if (picker?.type === "replace") {
      const { deckIdx, cardIdx, face } = picker;
      setDecks((prev) => {
        const next = prev.map((d, i) =>
          i === deckIdx
            ? { ...d, cards: d.cards.map((c, j) => (j === cardIdx ? { ...c, [face]: id } : c)) }
            : d,
        );
        logDecks(next);
        return next;
      });
      setPicker(null);
      return;
    }
    toggleSprite(id);
  }

  /** 新建卡组：当前选中的图片 → 卡正面列表，随后进入选背面模式 */
  function handleAddDeck() {
    if (selected.size === 0) return;
    const newDeck: Deck = { cards: Array.from(selected).map((id) => ({ frontSpriteId: id, backSpriteId: "" })) };
    const next = [...decks, newDeck];
    setDecks(next);
    setSelected(new Set());
    setPicker({ type: "back", deckIdx: next.length - 1 });
    logDecks(next);
  }

  function handleRemoveCard(deckIdx: number, cardIdx: number) {
    setDecks((prev) => {
      const next = prev.map((d, i) => (i === deckIdx ? { ...d, cards: d.cards.filter((_, j) => j !== cardIdx) } : d));
      logDecks(next);
      return next;
    });
  }

  function handleRemoveDeck(deckIdx: number) {
    setDecks((prev) => {
      const next = prev.filter((_, i) => i !== deckIdx);
      logDecks(next);
      return next;
    });
  }

  function spriteUrl(id: string): string {
    return sprites.find((s) => s.id === id)?.url ?? "";
  }

  /** 当前格是否处于替换目标（闪烁提示） */
  function isPicking(di: number, ci: number, face: "front" | "back"): boolean {
    return picker?.type === "replace" && picker.deckIdx === di && picker.cardIdx === ci && picker.face === face;
  }

  function togglePage(page: number) {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  }

  return (
    <main className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">PnP PDF 导入</h2>
        <Link href="/games" className="link-pop text-sm">
          ← 返回游戏广场
        </Link>
      </div>

      {/* 选择 PDF */}
      <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
      <button
        className="dashed-zone w-full p-4 text-sm text-muted hover:text-primary cursor-pointer mb-4 bg-card"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
      >
        {file ? `📄 ${file.name}（${pageCount} 页）` : "点击选择 .pdf 文件"}
      </button>

      {file && (
        <>
          {/* 页面选择（勾选参与切割的页） */}
          <div className="mb-3 p-3 border-2 border-ink">
            <div className="flex items-center gap-3 mb-2">
              <p className="text-sm font-medium">页面选择</p>
              <button className="link-pop text-[11px]" onClick={() => setSelectedPages(new Set(Array.from({ length: pageCount }, (_, i) => i + 1)))}>
                全选
              </button>
              <button className="link-pop text-[11px]" onClick={() => setSelectedPages(new Set())}>
                全不选
              </button>
              <span className="text-[11px] text-muted">已选 {selectedPages.size}/{pageCount} 页，仅勾选页参与切割</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: pageCount }).map((_, i) => {
                const page = i + 1;
                const checked = selectedPages.has(page);
                return (
                  <label
                    key={page}
                    className={`flex items-center gap-1 text-xs cursor-pointer border-2 px-2 py-1 select-none transition-colors ${checked ? "border-red-500 bg-card" : "border-ink opacity-60 hover:opacity-100"}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => togglePage(page)} className="accent-red-500" />
                    第 {page} 页
                  </label>
                );
              })}
            </div>
          </div>

          {/* 全局切割参数 */}
          <div className="flex flex-wrap items-end gap-3 mb-3 p-3 border-2 border-ink">
            <label className="text-xs text-secondary flex flex-col gap-1">
              行数
              <input
                type="number" min={1} max={12}
                className="input-pop w-16"
                value={rows}
                onChange={(e) => handleGridChange("rows", e.target.value)}
              />
            </label>
            <label className="text-xs text-secondary flex flex-col gap-1">
              列数
              <input
                type="number" min={1} max={12}
                className="input-pop w-16"
                value={cols}
                onChange={(e) => handleGridChange("cols", e.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[11px] text-muted">页边距</span>
              <CropInput label="上" value={crop.marginTop} onChange={(v) => handleCropChange("marginTop", v)} />
              <CropInput label="下" value={crop.marginBottom} onChange={(v) => handleCropChange("marginBottom", v)} />
              <CropInput label="左" value={crop.marginLeft} onChange={(v) => handleCropChange("marginLeft", v)} />
              <CropInput label="右" value={crop.marginRight} onChange={(v) => handleCropChange("marginRight", v)} />
              <span className="text-[11px] text-muted ml-2">牌间隔</span>
              <CropInput label="横" value={crop.gapX} onChange={(v) => handleCropChange("gapX", v)} />
              <CropInput label="纵" value={crop.gapY} onChange={(v) => handleCropChange("gapY", v)} />
            </div>
            <button
              className="btn-pop text-sm"
              onClick={handleCrop}
              disabled={busy || !file || selectedPages.size === 0}
            >
              {busy ? "切割中..." : `切割勾选页（${selectedPages.size} 页）`}
            </button>
          </div>

          {/* 页面预览（只显示勾选页，格子线按当前参数实时计算） */}
          <div className="mb-3 p-3 border-2 border-ink">
            <p className="text-sm font-medium mb-2">页面预览（{selectedPages.size}/{pageCount} 页，调参实时对齐格子线）</p>
            <div className="flex flex-wrap gap-4">
              {previews.map((p, i) => {
                const page = i + 1;
                if (!selectedPages.has(page)) return null;
                return (
                  <div key={i} className="w-[240px]">
                    <GridPreview prev={p} label={`第 ${page} 页`} rows={rows} cols={cols} crop={crop} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* 图片池 */}
          {sprites.length > 0 && (
            <div className="border-2 border-ink p-3">
              <p className="text-sm font-medium mb-2">
                图片池（{sprites.length} 张，选中 {selected.size} 张）
              </p>
              <div className="flex items-center gap-3 mb-2">
                <button className="link-pop text-[11px]" onClick={() => setSelected(new Set(sprites.map((s) => s.id)))}>
                  全选
                </button>
                <button className="link-pop text-[11px]" onClick={() => setSelected(new Set())}>
                  全不选
                </button>
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))" }}>
                {sprites.map((s, i) => {
                  const isSel = selected.has(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => handleSpriteClick(s.id)}
                      className={`relative flex flex-col items-center gap-1 p-1 border-2 bg-card transition-colors ${isSel ? "border-red-500 ring-2 ring-red-500/30" : "border-ink hover:border-secondary"}`}
                    >
                      <img src={s.url} alt={s.id} className="w-full h-[112px] object-cover" />
                      <span className="text-[10px] font-mono text-secondary">{s.id}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 卡组区 */}
          <div className="border-2 border-ink p-3 mt-3">
            <div className="flex items-center gap-3 mb-2">
              <p className="text-sm font-medium">
                卡组（{decks.length} 个，共 {decks.reduce((n, d) => n + d.cards.length, 0)} 张卡）
              </p>
              <button className="btn-pop text-sm" onClick={handleAddDeck} disabled={selected.size === 0}>
                + 新建卡组（{selected.size} 张）
              </button>
            </div>

            {picker && (
              <div className="flex items-center gap-2 mb-2 px-2 py-1 bg-yellow-200/70 border-2 border-ink text-xs">
                <span>
                  {picker.type === "back"
                    ? `为「卡组 ${picker.deckIdx + 1}」选择共用背面：点击图片池图片，或跳过用默认卡背`
                    : `替换「卡组 ${picker.deckIdx + 1}」第 ${picker.cardIdx + 1} 张卡的${picker.face === "front" ? "正面" : "背面"}：点击图片池图片`}
                </span>
                {picker.type === "back" && (
                  <button className="link-pop text-[11px]" onClick={() => setPicker(null)}>
                    跳过（默认卡背）
                  </button>
                )}
                <button className="link-pop text-[11px]" onClick={() => setPicker(null)}>
                  取消
                </button>
              </div>
            )}

            {decks.length === 0 ? (
              <p className="text-[11px] text-muted">先在图片池选中图片，再点「新建卡组」</p>
            ) : (
              decks.map((deck, di) => (
                <div key={di} className="border-2 border-ink p-2 mb-2 bg-card">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">卡组 {di + 1}（{deck.cards.length} 张卡）</span>
                    <button className="link-pop text-[11px] text-red-500" onClick={() => handleRemoveDeck(di)}>
                      删除卡组
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {deck.cards.map((card, ci) => (
                      <div key={ci} className="flex items-center gap-2 border border-ink/40 p-1">
                        <button
                          className={`relative w-10 h-14 border-2 overflow-hidden bg-[#1e3a5f] ${isPicking(di, ci, "front") ? "animate-pulse border-red-500" : "border-transparent hover:border-secondary"}`}
                          onClick={() => setPicker({ type: "replace", deckIdx: di, cardIdx: ci, face: "front" })}
                          title="点击替换正面"
                        >
                          <img src={spriteUrl(card.frontSpriteId)} alt="正面" className="w-full h-full object-cover" />
                        </button>
                        <button
                          className={`relative w-10 h-14 border-2 overflow-hidden bg-[#1e3a5f] ${isPicking(di, ci, "back") ? "animate-pulse border-red-500" : "border-transparent hover:border-secondary"}`}
                          onClick={() => setPicker({ type: "replace", deckIdx: di, cardIdx: ci, face: "back" })}
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
                        <button className="link-pop text-[11px] text-red-500" onClick={() => handleRemoveCard(di, ci)}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {error && <p className="mt-2 text-red-500 text-sm">{error}</p>}
      {progress && <p className="mt-2 text-secondary text-sm">{progress}</p>}
    </main>
  );
}
