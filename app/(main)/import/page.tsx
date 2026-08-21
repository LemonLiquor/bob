"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { getPageCount, renderPageToCanvas } from "@/lib/pnp/pdf";
import { cropGrid, buildGameFromDecks, DEFAULT_CROP, type CropConfig, type Deck } from "@/lib/pnp/crop";
import type { GameAction, GameState, Sprite } from "@/lib/engine/types";
import { applyAction } from "@/lib/engine";
import { setAssets } from "@/lib/assets/cache";
import GameBoard from "@/components/game/GameBoard";
import PagePicker from "@/components/import/PagePicker";
import CropParams from "@/components/import/CropParams";
import PagePreviews from "@/components/import/PagePreviews";
import SpritePool from "@/components/import/SpritePool";
import DeckBuilder, { type Picker } from "@/components/import/DeckBuilder";
import GeneratePanel, { type PendingUpload } from "@/components/import/GeneratePanel";
import type { PreviewData } from "@/components/import/GridPreview";

// ============================================================
// PnP PDF 导入页 — 状态与逻辑中枢，UI 拆分至 components/import/
// 流程：选 PDF → 页面多选 → 切割参数 → 预览 → 图片池 → 卡组组装
//       → 生成桌游数据 json（S4a）→ Lab 调整（S4b）→ 上传（S4c）
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
  const [name, setName] = useState("");
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [sprites, setSprites] = useState<Sprite[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [previews, setPreviews] = useState<(PreviewData | null)[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [picker, setPicker] = useState<Picker>(null);
  const loadToken = useRef(0); // 防止换文件后旧预览乱序覆盖
  const [view, setView] = useState<"import" | "lab">("import");
  const [labState, setLabState] = useState<GameState | null>(null);
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
    setName(f.name.replace(/\.pdf$/i, ""));
    setError(null);
    setBusy(true);
    try {
      const count = await getPageCount(f);
      setPageCount(count);
      setSprites([]);
      setSelected(new Set());
      setDecks([]);
      setPicker(null);
      setPendingUpload(null);
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

  /** 生成桌游数据 json（坐标 0），资产入缓存后直接进入 Lab 沙盒调整初始布局 */
  function handleGenerate() {
    if (!file || sprites.length === 0 || !name.trim()) return;
    const { prefabs, entities, piles } = buildGameFromDecks(decks);
    const payload: PendingUpload = {
      meta: { id: `pnp-${Date.now()}`, name: name.trim(), icon: "🖼️" },
      assets: { sprites, prefabs },
      initialState: { entities, piles, seats: [] },
    };
    setPendingUpload(payload);
    console.log("generated:", {
      meta: payload.meta,
      assets: {
        sprites: payload.assets.sprites.map((s) => ({ id: s.id, url: s.url.slice(0, 60) + `…(${s.url.length})` })),
        prefabs: payload.assets.prefabs,
      },
      initialState: payload.initialState,
    });
    // 资产入缓存（Lab 渲染必需：getPrefabFaces 按 prefabId 查表）
    setAssets(payload.assets);
    setLabState(payload.initialState);
    setView("lab");
  }

  /** S4b Lab：拖拽后的坐标写回 initialState（seats 保持无座），控制台输出保存后的 json */
  function handleSaveFromLab() {
    if (!labState) return;
    const nextInitialState: GameState = { ...labState, seats: [] };
    setPendingUpload((prev) => (prev ? { ...prev, initialState: nextInitialState } : prev));
    console.log("saved initialState:", JSON.parse(JSON.stringify(nextInitialState)));
    setView("import");
  }

  /** S4b Lab：放弃本次调整，返回导入页（不写回） */
  function handleDiscardLab() {
    setView("import");
  }

  /** S4b Lab：本地 applyAction（复用引擎，与服务端同分发） */
  function handleLabAction(action: GameAction) {
    setLabState((prev) => (prev ? applyAction(prev, action) : prev));
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

  function togglePage(page: number) {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  }

  // S4b Lab：全屏沙盒视图（无座，拖摆初始布局）
  if (view === "lab" && labState) {
    return (
      // (main) 布局无全屏高度，h-screen 容器给 GameBoard 的 h-full 提供继承高度
      <div className="h-screen">
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border-2 border-ink px-4 py-2">
          <span className="text-sm font-bold">Lab — 调整初始布局</span>
          <span className="text-[11px] text-muted">拖动卡牌/牌堆摆放初始位置（无座）</span>
        </div>
        <button className="btn-ghost fixed bottom-3 left-3 z-50 text-xs" onClick={handleDiscardLab}>
          放弃返回
        </button>
        <button className="btn-pop fixed bottom-3 right-3 z-50 text-xs" onClick={handleSaveFromLab}>
          保存并返回
        </button>
        <GameBoard gameState={labState} onAction={handleLabAction} />
      </div>
    );
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
          <PagePicker
            pageCount={pageCount}
            selectedPages={selectedPages}
            onTogglePage={togglePage}
            onSelectAll={() => setSelectedPages(new Set(Array.from({ length: pageCount }, (_, i) => i + 1)))}
            onSelectNone={() => setSelectedPages(new Set())}
          />
          <CropParams
            rows={rows}
            cols={cols}
            crop={crop}
            busy={busy}
            selectedPagesCount={selectedPages.size}
            onGridChange={handleGridChange}
            onCropChange={handleCropChange}
            onCrop={handleCrop}
          />
          <PagePreviews
            previews={previews}
            selectedPages={selectedPages}
            pageCount={pageCount}
            rows={rows}
            cols={cols}
            crop={crop}
          />
          {sprites.length > 0 && (
            <SpritePool
              sprites={sprites}
              selected={selected}
              onToggle={handleSpriteClick}
              onSelectAll={() => setSelected(new Set(sprites.map((s) => s.id)))}
              onSelectNone={() => setSelected(new Set())}
            />
          )}
          <DeckBuilder
            decks={decks}
            sprites={sprites}
            picker={picker}
            selectedCount={selected.size}
            onAddDeck={handleAddDeck}
            onRemoveCard={handleRemoveCard}
            onRemoveDeck={handleRemoveDeck}
            onSetPicker={setPicker}
          />
        </>
      )}

      <GeneratePanel
        name={name}
        onNameChange={setName}
        canGenerate={!!file && sprites.length > 0 && !!name.trim()}
        onGenerate={handleGenerate}
      />

      {error && <p className="mt-2 text-red-500 text-sm">{error}</p>}
      {progress && <p className="mt-2 text-secondary text-sm">{progress}</p>}
    </main>
  );
}
