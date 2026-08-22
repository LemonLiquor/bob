"use client";

import { useRef, useState } from "react";
import { getPageCount, renderPageToCanvas } from "@/lib/pnp/pdf";
import { cropGrid, mirrorBackIndex, toCircular, DEFAULT_CROP, type CropConfig, type EntityGroup } from "@/lib/pnp/crop";
import type { Sprite } from "@/lib/engine/types";
import PagePicker from "@/components/import/PagePicker";
import CropParams from "@/components/import/CropParams";
import PagePreviews from "@/components/import/PagePreviews";
import EntityPanel from "@/components/import/EntityPanel";
import SpritePool from "@/components/import/SpritePool";
import EntityGroupBuilder, { type Picker } from "@/components/import/EntityGroupBuilder";
import GeneratePanel from "@/components/import/GeneratePanel";
import type { PreviewData } from "@/components/import/GridPreview";

// ============================================================
// ImportFlow — PnP PDF 导入流程（弹窗，切片 3b）
// 流程：选 PDF → 页面多选 → 切割参数 → 预览 → 实体定义 → 图片池 → 实体组组装
//       → [导入] 提交（onCommit 上桌，页面负责摊平/摆位/合并）
// 状态全部内部自持；sprite id 由工作区 allocSpriteId 分配（跨批次不重复）。
// ============================================================

const CROP_STORAGE_KEY = "import_crop_params";

interface StoredCropParams {
  rows: number;
  cols: number;
  crop: CropConfig;
}

/** 读取上次切割参数（localStorage，损坏/缺失回退默认） */
function loadCropParams(): StoredCropParams {
  if (typeof window === "undefined") return { rows: 4, cols: 4, crop: DEFAULT_CROP };
  try {
    const raw = localStorage.getItem(CROP_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<StoredCropParams>;
      const num = (v: unknown, d: number) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : d;
      };
      const c = (p.crop ?? {}) as Partial<CropConfig>;
      return {
        rows: Math.max(1, Math.min(12, num(p.rows, 4))),
        cols: Math.max(1, Math.min(12, num(p.cols, 4))),
        crop: {
          marginTop: Math.max(0, num(c.marginTop, 0)),
          marginBottom: Math.max(0, num(c.marginBottom, 0)),
          marginLeft: Math.max(0, num(c.marginLeft, 0)),
          marginRight: Math.max(0, num(c.marginRight, 0)),
          gapX: Math.max(0, num(c.gapX, 0)),
          gapY: Math.max(0, num(c.gapY, 0)),
        },
      };
    }
  } catch {
    /* 解析失败用默认 */
  }
  return { rows: 4, cols: 4, crop: DEFAULT_CROP };
}

/** 切割成功时保存参数 */
function saveCropParams(rows: number, cols: number, crop: CropConfig): void {
  try {
    localStorage.setItem(CROP_STORAGE_KEY, JSON.stringify({ rows, cols, crop }));
  } catch {
    /* 忽略 */
  }
}

interface ImportFlowProps {
  onClose: () => void; // 关闭弹窗回工作台
  allocSpriteId: () => string; // 工作区全局 sprite id 分配（跨批次永不重复）
  onCommit: (payload: {
    sprites: Sprite[];
    groups: EntityGroup[];
    sizes: Map<string, { width: number; height: number }>;
    fileName: string;
    name: string;
  }) => void; // 提交本批次（页面负责摊平/摆位/合并工作区）；name = PDF 文件名（桌游名在 lab 上传弹窗设置）
}

export default function ImportFlow({ onClose, allocSpriteId, onCommit }: ImportFlowProps) {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [initCrop] = useState(loadCropParams); // 进入页面恢复上次切割参数
  const [rows, setRows] = useState(initCrop.rows);
  const [cols, setCols] = useState(initCrop.cols);
  const [crop, setCrop] = useState<CropConfig>(initCrop.crop);
  const [sprites, setSprites] = useState<Sprite[]>([]); // 全量累积（实体组引用的旧批次保留，生成全量上传）
  const [lastBatch, setLastBatch] = useState<Sprite[]>([]); // 最近一次切割结果（实体定义面板/图片池显示）
  const [pageSprites, setPageSprites] = useState<Map<number, Sprite[]>>(new Map()); // 页号 → 该页最新批次（自动组卡用）
  const [poolFilter, setPoolFilter] = useState<Set<string>>(new Set()); // 实体定义选中集（图片池显示过滤）
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [previews, setPreviews] = useState<(PreviewData | null)[]>([]);
  const [groups, setGroups] = useState<EntityGroup[]>([]);
  const [picker, setPicker] = useState<Picker>(null);
  // 实体定义面板状态：形状（默认矩形）+ 渲染大小（默认未设置 = 卡牌 120×168）
  const [shapes, setShapes] = useState<Map<string, "rect" | "circle">>(new Map());
  const [sizes, setSizes] = useState<Map<string, { width: number; height: number }>>(new Map());
  const [shapeBusy, setShapeBusy] = useState<Set<string>>(new Set());
  const originalUrlsRef = useRef<Map<string, string>>(new Map()); // 原始矩形 dataURL（恢复用）
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
      setLastBatch([]);
      setPageSprites(new Map());
      setPoolFilter(new Set());
      setSelected(new Set());
      setGroups([]);
      setPicker(null);
      setShapes(new Map());
      setSizes(new Map());
      setShapeBusy(new Set());
      originalUrlsRef.current = new Map();
      // 默认全不选 + 不加载预览（大 PDF 不一次性全加载）；勾选页时才加载
      loadToken.current++; // 换文件：旧异步预览结果丢弃
      setSelectedPages(new Set());
      setPreviews(new Array(count).fill(null));
    } catch (err) {
      setError(`PDF 解析失败: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  /** 勾选页时才加载该页预览（token 防换文件乱序） */
  async function loadPreviewPage(page: number) {
    if (!file) return;
    const token = loadToken.current;
    try {
      const p = await loadPreview(file, page);
      if (loadToken.current !== token) return; // 已换文件，丢弃
      setPreviews((prev) => prev.map((x, i) => (i === page - 1 ? p : x)));
    } catch {
      /* 单页失败不中断 */
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

  /** 切割勾选页 → 追加式：sprites 全量累积（组引用保留），
   *  实体定义面板只显示最近一次切割（lastBatch）并自动全选；
   *  sprite id 全局计数器递增永不重用 */
  async function handleCrop() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const pages = Array.from(selectedPages).sort((a, b) => a - b);
    const allBatch: Sprite[] = [];
    const pageBatches = new Map<number, Sprite[]>();
    try {
      for (const page of pages) {
        setProgress(`正在切割第 ${page}/${pageCount} 页（勾选 ${pages.length} 页）...`);
        const canvas = await renderPageToCanvas(file, page);
        const urls = cropGrid(canvas, rows, cols, crop);
        const pageBatch: Sprite[] = urls.map((url) => ({ id: allocSpriteId(), url }));
        pageBatches.set(page, pageBatch);
        allBatch.push(...pageBatch);
      }
      setPageSprites((prev) => {
        const next = new Map(prev);
        for (const [page, batch] of pageBatches) next.set(page, batch);
        return next;
      });
      setSprites((prev) => [...prev, ...allBatch]);
      setLastBatch(allBatch);
      setPoolFilter(new Set(allBatch.map((s) => s.id))); // 自动全选最新批次（分批处理）
      setSelected(new Set());
      saveCropParams(rows, cols, crop); // 切割成功 → 记住本次参数
      // 保留 groups / shapes / sizes（分批追加）
    } catch (err) {
      setError(`切割失败: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  /** 导入：提交本批次到工作区（页面摊平/摆位/合并） + 关弹窗。桌游名 = PDF 文件名（lab 上传弹窗可改） */
  function handleImport() {
    if (!file || sprites.length === 0) return;
    onCommit({ sprites, groups, sizes, fileName: file.name, name: file.name.replace(/\.pdf$/i, "") });
    onClose();
  }

  /** 实体定义：切换单图形状（矩形 ↔ 圆形）。圆形 = canvas 遮罩生成透明 PNG，原始暂存可恢复 */
  async function handleToggleShape(id: string) {
    const current = shapes.get(id) ?? "rect";
    if (current === "rect") {
      const sprite = sprites.find((s) => s.id === id);
      if (!sprite) return;
      originalUrlsRef.current.set(id, sprite.url);
      setShapeBusy((prev) => new Set(prev).add(id));
      try {
        const circularUrl = await toCircular(sprite.url);
        // 同步更新全量与面板批次（面板显示 lastBatch）
        setSprites((prev) => prev.map((s) => (s.id === id ? { ...s, url: circularUrl } : s)));
        setLastBatch((prev) => prev.map((s) => (s.id === id ? { ...s, url: circularUrl } : s)));
        setShapes((prev) => new Map(prev).set(id, "circle"));
      } catch {
        /* 处理失败保持原样 */
      } finally {
        setShapeBusy((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    } else {
      // 恢复矩形（原始 dataURL 或直接标回 rect）
      const original = originalUrlsRef.current.get(id);
      if (original) {
        setSprites((prev) => prev.map((s) => (s.id === id ? { ...s, url: original } : s)));
        setLastBatch((prev) => prev.map((s) => (s.id === id ? { ...s, url: original } : s)));
      }
      setShapes((prev) => new Map(prev).set(id, "rect"));
    }
  }

  /** 实体定义：批量切换形状（串行处理） */
  async function handleBatchShape(ids: string[], shape: "rect" | "circle") {
    for (const id of ids) {
      if ((shapes.get(id) ?? "rect") === shape) continue;
      await handleToggleShape(id);
    }
  }

  /** 实体定义：批量设置渲染大小 */
  function handleBatchSize(ids: string[], size: { width: number; height: number }) {
    setSizes((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.set(id, size);
      return next;
    });
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
      // 设为实体组所有实体的共用背面（单面组已固定，不会再进入此模式）
      const { groupIdx } = picker;
      setGroups((prev) => {
        const next = prev.map((g, i) =>
          i === groupIdx ? { ...g, items: g.items.map((it) => ({ ...it, backSpriteId: id })) } : g,
        );
        return next;
      });
      setPicker(null);
      return;
    }
    if (picker?.type === "replace") {
      const { groupIdx, itemIdx, face } = picker;
      // 字段名与 face 值不同（frontSpriteId / backSpriteId），需映射
      const key = face === "front" ? "frontSpriteId" : "backSpriteId";
      setGroups((prev) => {
        const next = prev.map((g, i) =>
          i === groupIdx
            ? { ...g, items: g.items.map((it, j) => (j === itemIdx ? { ...it, [key]: id } : it)) }
            : g,
        );
        return next;
      });
      setPicker(null);
      return;
    }
    toggleSprite(id);
  }

  /** 新建实体组：当前选中的图片 → 正面列表（默认卡牌组），随后进入选背面模式 */
  /** 新建实体组：按类型（卡牌/Token/版图）。仅卡牌进入选背面；token/board 单面直接完成 */
  function handleAddGroup(kind: EntityGroup["kind"]) {
    if (selected.size === 0) return;
    const newGroup: EntityGroup = { kind, items: Array.from(selected).map((id) => ({ frontSpriteId: id, backSpriteId: "" })) };
    const next = [...groups, newGroup];
    setGroups(next);
    setSelected(new Set());
    setPicker(kind === "card" ? { type: "back", groupIdx: next.length - 1 } : null);
  }

  function handleRemoveItem(groupIdx: number, itemIdx: number) {
    setGroups((prev) => {
      const next = prev.map((g, i) => (i === groupIdx ? { ...g, items: g.items.filter((_, j) => j !== itemIdx) } : g));
      return next;
    });
  }

  function handleRemoveGroup(groupIdx: number) {
    setGroups((prev) => {
      const next = prev.filter((_, i) => i !== groupIdx);
      return next;
    });
  }

  /** 页对预设：勾选页按顺序两两配对，全部合入**一个实体组**
   *  （正面 = 前页切图，背面 = 后页镜像图；奇数页最后一对无背面 = 默认卡背）
   *  按页号取该页最新批次（不依赖 id 连续性） */
  function handleAutoPairGroups() {
    if (sprites.length === 0) return;
    const sorted = Array.from(selectedPages).sort((a, b) => a - b);
    const items: EntityGroup["items"] = [];
    for (let i = 0; i < sorted.length; i += 2) {
      const front = pageSprites.get(sorted[i]) ?? [];
      const back = pageSprites.get(sorted[i + 1]) ?? [];
      for (let k = 0; k < front.length; k++) {
        items.push({
          frontSpriteId: front[k].id,
          backSpriteId: back.length ? back[mirrorBackIndex(k, cols)].id : "",
        });
      }
    }
    setGroups((prev) => [...prev, { kind: "card", items }]);
  }

  function togglePage(page: number) {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(page)) {
        next.delete(page);
        // 取消勾选：清空该页预览
        setPreviews((p) => p.map((x, i) => (i === page - 1 ? null : x)));
      } else {
        next.add(page);
        // 勾选：加载该页预览
        void loadPreviewPage(page);
      }
      return next;
    });
  }

  return (
    <main className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">PnP PDF 导入</h2>
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
            onSelectAll={() => {
              setSelectedPages(new Set(Array.from({ length: pageCount }, (_, i) => i + 1)));
              // 全选：加载全部页预览
              for (let page = 1; page <= pageCount; page++) void loadPreviewPage(page);
            }}
            onSelectNone={() => {
              setSelectedPages(new Set());
              // 全不选：清空预览
              setPreviews(new Array(pageCount).fill(null));
            }}
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
          {lastBatch.length > 0 && (
            <EntityPanel
              sprites={lastBatch}
              shapes={shapes}
              sizes={sizes}
              busyIds={shapeBusy}
              selected={poolFilter}
              onSelectionChange={setPoolFilter}
              onToggleShape={handleToggleShape}
              onBatchShape={handleBatchShape}
              onBatchSize={handleBatchSize}
              pickerActive={picker !== null}
              onSpriteClick={handleSpriteClick}
            />
          )}
          {(() => {
            // 图片池 = 实体定义选中集（基于最近一次切割）；实体组板块与图片池同现同隐（无图可组时不显示）
            const poolSprites = poolFilter.size > 0 ? lastBatch.filter((s) => poolFilter.has(s.id)) : [];
            return (
              <>
                {poolSprites.length > 0 ? (
                  <SpritePool
                    sprites={poolSprites}
                    selected={selected}
                    onToggle={handleSpriteClick}
                    onSelectAll={() => setSelected(new Set(poolSprites.map((s) => s.id)))}
                    onSelectNone={() => setSelected(new Set())}
                  />
                ) : (
                  <p className="text-[11px] text-muted mt-2">
                    图片池仅显示实体定义面板中选中的图片；请先在实体定义面板全选或点选图片
                  </p>
                )}
                {poolSprites.length > 0 && (
                  <EntityGroupBuilder
                    groups={groups}
                    sprites={sprites}
                    picker={picker}
                    selectedCount={selected.size}
                    onAddGroup={handleAddGroup}
                    onAutoPair={handleAutoPairGroups}
                    onRemoveItem={handleRemoveItem}
                    onRemoveGroup={handleRemoveGroup}
                    onSetPicker={setPicker}
                  />
                )}
              </>
            );
          })()}
        </>
      )}

      <GeneratePanel
        canImport={!!file && sprites.length > 0}
        onImport={handleImport}
        onCancel={onClose}
      />

      {error && <p className="mt-2 text-red-500 text-sm">{error}</p>}
      {progress && <p className="mt-2 text-secondary text-sm">{progress}</p>}
    </main>
  );
}
