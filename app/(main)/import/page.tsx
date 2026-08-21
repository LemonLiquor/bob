"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { getPageCount, renderPageToCanvas } from "@/lib/pnp/pdf";
import { cropGrid, DEFAULT_CROP, type CropConfig } from "@/lib/pnp/crop";
import type { Sprite } from "@/lib/engine/types";
import CropInput from "@/components/import/CropInput";
import GridPreview, { type PreviewData } from "@/components/import/GridPreview";

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

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(4);
  const [crop, setCrop] = useState<CropConfig>(DEFAULT_CROP);
  const [sprites, setSprites] = useState<Sprite[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<(PreviewData | null)[]>([]);
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

  /** 切割全部页 → 图片资源池（sprite id 全局连续） */
  async function handleCrop() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const list: Sprite[] = [];
    try {
      for (let page = 1; page <= pageCount; page++) {
        setProgress(`正在切割第 ${page}/${pageCount} 页...`);
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

  /** 点击切换图片选中态（S3 组卡用） */
  function toggleSprite(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
              disabled={busy || !file}
            >
              {busy ? "切割中..." : "切割全部页"}
            </button>
          </div>

          {/* 全部页预览（格子线按当前参数实时计算） */}
          <div className="mb-3 p-3 border-2 border-ink">
            <p className="text-sm font-medium mb-2">页面预览（{pageCount} 页，调参实时对齐格子线）</p>
            <div className="flex flex-wrap gap-4">
              {previews.map((p, i) => (
                <div key={i} className="w-[240px]">
                  <GridPreview prev={p} label={`第 ${i + 1} 页`} rows={rows} cols={cols} crop={crop} />
                </div>
              ))}
            </div>
          </div>

          {/* 图片池 */}
          {sprites.length > 0 && (
            <div className="border-2 border-ink p-3">
              <p className="text-sm font-medium mb-2">
                图片池（{sprites.length} 张，选中 {selected.size} 张）
              </p>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))" }}>
                {sprites.map((s, i) => {
                  const isSel = selected.has(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleSprite(s.id)}
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
        </>
      )}

      {error && <p className="mt-2 text-red-500 text-sm">{error}</p>}
      {progress && <p className="mt-2 text-secondary text-sm">{progress}</p>}
    </main>
  );
}
