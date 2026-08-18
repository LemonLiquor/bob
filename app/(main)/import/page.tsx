"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { send, onMessage } from "@/lib/multiplayer/transport";
import { getPageCount, renderPageToCanvas } from "@/lib/pnp/pdf";
import { cropGrid, buildPnpAssetsMulti, DEFAULT_CROP, type CropConfig } from "@/lib/pnp/crop";
import type { ServerMessage } from "@/lib/multiplayer/protocol";
import CropInput from "@/components/import/CropInput";
import GridPreview, { type PreviewData } from "@/components/import/GridPreview";

/** 页对：正面页 + 背面页（物理打印正反交替：1正2反3正4反…） */
interface PagePair {
  frontPage: number;       // 1-based
  backPage: number | null; // 1-based，null = 无背面（默认卡背）
  enabled: boolean;
}

// ============================================================
// PnP PDF 导入页（独立页面，便于后续扩展 PDF 功能）
// 多页正反交替 PDF 一次性导入：全部页对裁切后合成一个桌游
// 全局参数（行/列/边距/间隔）对所有页对生效，预览格子线实时对齐
// ============================================================

export default function ImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(4);
  const [name, setName] = useState("");
  const [crop, setCrop] = useState<CropConfig>(DEFAULT_CROP);
  const [pairs, setPairs] = useState<PagePair[]>([]);
  const [previews, setPreviews] = useState<{ front: PreviewData | null; back: PreviewData | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingGameId = useRef<string | null>(null);
  const loadToken = useRef(0); // 防止换文件后旧预览乱序覆盖

  // 上传成功（匹配 gameId）→ 跳回游戏广场（列表自动刷新）
  useEffect(() => {
    const unsub = onMessage((msg: ServerMessage) => {
      if (msg.type === "game_uploaded" && msg.gameId === pendingGameId.current) {
        pendingGameId.current = null;
        router.push("/games");
      } else if (msg.type === "error" && pendingGameId.current) {
        pendingGameId.current = null;
        setError("上传失败，请重试");
        setBusy(false);
      }
    });
    return unsub;
  }, [router]);

  async function loadPreview(f: File, page: number): Promise<PreviewData> {
    const canvas = await renderPageToCanvas(f, page);
    return {
      src: canvas.toDataURL("image/jpeg", 0.9),
      width: canvas.width,
      height: canvas.height,
    };
  }

  /** 正反交替识别：页对 = (1,2),(3,4),…；奇数页最后一页无背面 */
  function buildPairs(count: number): PagePair[] {
    const list: PagePair[] = [];
    for (let i = 1; i <= count; i += 2) {
      list.push({ frontPage: i, backPage: i + 1 <= count ? i + 1 : null, enabled: true });
    }
    return list;
  }

  async function reloadPairPreview(idx: number) {
    if (!file) return;
    const pair = pairs[idx];
    try {
      const front = await loadPreview(file, pair.frontPage);
      const back = pair.backPage != null ? await loadPreview(file, pair.backPage) : null;
      setPreviews((prev) => prev.map((p, i) => (i === idx ? { front, back } : p)));
    } catch (e) {
      setError(`页面渲染失败: ${(e as Error).message}`);
    }
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
      const list = buildPairs(count);
      setPairs(list);
      setPreviews(list.map(() => ({ front: null, back: null })));

      // 逐对加载预览（token 防乱序：换文件后旧异步结果丢弃）
      const token = ++loadToken.current;
      for (let i = 0; i < list.length; i++) {
        const pair = list[i];
        const p: { front: PreviewData | null; back: PreviewData | null } = { front: null, back: null };
        try {
          p.front = await loadPreview(f, pair.frontPage);
        } catch { /* 单页失败不中断 */ }
        if (pair.backPage != null) {
          try {
            p.back = await loadPreview(f, pair.backPage);
          } catch { /* 单页失败不中断 */ }
        }
        if (loadToken.current !== token) return; // 已换文件，丢弃
        setPreviews((prev) => prev.map((x, idx) => (idx === i ? p : x)));
      }
    } catch (err) {
      setError(`PDF 解析失败: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function handlePairPageChange(idx: number, kind: "front" | "back", value: string) {
    const v = value === "" ? 0 : Number(value);
    const next = { ...pairs[idx] };
    if (kind === "front") next.frontPage = v;
    else next.backPage = value === "none" ? null : v;
    setPairs((prev) => prev.map((p, i) => (i === idx ? next : p)));
    reloadPairPreview(idx);
  }

  function handlePairEnabled(idx: number, enabled: boolean) {
    setPairs((prev) => prev.map((p, i) => (i === idx ? { ...p, enabled } : p)));
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

  /** 全部启用页对裁切 → 合成一个桌游 → 上传 */
  async function handleImport() {
    if (!file || !name.trim()) return;
    setBusy(true);
    setError(null);
    setProgress("");
    try {
      const active = pairs.filter((p) => p.enabled);
      const pagePairs: { frontDataUrls: string[]; backDataUrls: string[] | null }[] = [];
      for (let i = 0; i < active.length; i++) {
        const pair = active[i];
        setProgress(`正在裁切页对 ${i + 1}/${active.length}...`);
        const frontCanvas = await renderPageToCanvas(file, pair.frontPage);
        const frontDataUrls = cropGrid(frontCanvas, rows, cols, crop);
        let backDataUrls: string[] | null = null;
        if (pair.backPage != null) {
          const backCanvas = await renderPageToCanvas(file, pair.backPage);
          backDataUrls = cropGrid(backCanvas, rows, cols, crop);
        }
        pagePairs.push({ frontDataUrls, backDataUrls });
      }

      setProgress("正在上传...");
      const { meta, assets } = await buildPnpAssetsMulti({
        name: name.trim(),
        cols,
        pagePairs,
      });
      pendingGameId.current = meta.id;
      send({ type: "upload_game", meta, assets });
    } catch (err) {
      setError(`导入失败: ${(err as Error).message}`);
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <main className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">PnP PDF 导入</h2>
        <Link href="/games" className="text-sm text-blue-500 hover:text-blue-700">
          ← 返回游戏广场
        </Link>
      </div>

      {/* 选择 PDF */}
      <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
      <button
        className="w-full border-2 border-dashed border-[#ccc] rounded p-4 text-sm text-[#999] hover:border-blue-400 hover:text-blue-500 cursor-pointer mb-4"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
      >
        {file ? `📄 ${file.name}（${pageCount} 页 → ${pairs.length} 个页对）` : "点击选择 .pdf 文件（正反交替多页）"}
      </button>

      {file && (
        <>
          {/* 全局参数 */}
          <div className="flex flex-wrap items-end gap-3 mb-3 p-3 border border-[#eee] rounded">
            <label className="text-xs text-[#666] flex flex-col gap-1">
              行数
              <input
                type="number" min={1} max={12}
                className="border rounded px-2 py-1 text-sm w-16"
                value={rows}
                onChange={(e) => handleGridChange("rows", e.target.value)}
              />
            </label>
            <label className="text-xs text-[#666] flex flex-col gap-1">
              列数
              <input
                type="number" min={1} max={12}
                className="border rounded px-2 py-1 text-sm w-16"
                value={cols}
                onChange={(e) => handleGridChange("cols", e.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[11px] text-[#999]">页边距</span>
              <CropInput label="上" value={crop.marginTop} onChange={(v) => handleCropChange("marginTop", v)} />
              <CropInput label="下" value={crop.marginBottom} onChange={(v) => handleCropChange("marginBottom", v)} />
              <CropInput label="左" value={crop.marginLeft} onChange={(v) => handleCropChange("marginLeft", v)} />
              <CropInput label="右" value={crop.marginRight} onChange={(v) => handleCropChange("marginRight", v)} />
              <span className="text-[11px] text-[#999] ml-2">牌间隔</span>
              <CropInput label="横" value={crop.gapX} onChange={(v) => handleCropChange("gapX", v)} />
              <CropInput label="纵" value={crop.gapY} onChange={(v) => handleCropChange("gapY", v)} />
            </div>
            <label className="text-xs text-[#666] flex flex-col gap-1 flex-1 min-w-[160px]">
              游戏名
              <input
                className="border rounded px-2 py-1 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="我的桌游"
              />
            </label>
          </div>

          {/* 页对列表（正反交替） */}
          <div className="flex flex-col gap-4">
            {pairs.map((pair, idx) => (
              <div key={idx} className={`border border-[#eee] rounded p-3 ${pair.enabled ? "" : "opacity-50"}`}>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pair.enabled}
                      onChange={(e) => handlePairEnabled(idx, e.target.checked)}
                    />
                    页对 {idx + 1}
                  </label>
                  <label className="text-xs text-[#666] flex items-center gap-1">
                    正面页
                    <select
                      className="border rounded px-2 py-1 text-sm"
                      value={pair.frontPage}
                      onChange={(e) => handlePairPageChange(idx, "front", e.target.value)}
                    >
                      {Array.from({ length: pageCount }).map((_, i) => (
                        <option key={i} value={i + 1}>第 {i + 1} 页</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-[#666] flex items-center gap-1">
                    背面页
                    <select
                      className="border rounded px-2 py-1 text-sm"
                      value={pair.backPage ?? "none"}
                      onChange={(e) => handlePairPageChange(idx, "back", e.target.value)}
                    >
                      <option value="none">无（默认卡背）</option>
                      {Array.from({ length: pageCount }).map((_, i) => (
                        <option key={i} value={i + 1}>第 {i + 1} 页</option>
                      ))}
                    </select>
                  </label>
                  <span className="text-[11px] text-[#999]">
                    共 {rows * cols} 张卡（双面打印：正面第 i 行第 j 列 ↔ 背面第 i 行第 {cols} 列）
                  </span>
                </div>
                <div className="flex gap-4">
                  <GridPreview prev={previews[idx]?.front ?? null} label="正面" rows={rows} cols={cols} crop={crop} />
                  <GridPreview prev={previews[idx]?.back ?? null} label="背面" rows={rows} cols={cols} crop={crop} />
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-[#999] mt-3">
            提示：全部页对将合成一个桌游（共 {pairs.filter((p) => p.enabled).length * rows * cols} 张卡）；调整边距/间隔使红线对齐卡牌边缘
          </p>
        </>
      )}

      {error && <p className="mt-2 text-red-500 text-sm">{error}</p>}
      {progress && <p className="mt-2 text-[#666] text-sm">{progress}</p>}

      <div className="flex justify-end gap-2 mt-4">
        <Link
          href="/games"
          className="px-4 py-2 text-sm text-[#666] border border-[#ccc] rounded hover:bg-[#f5f5f5]"
        >
          取消
        </Link>
        <button
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded cursor-pointer hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!file || busy || !name.trim()}
          onClick={handleImport}
        >
          {busy ? "导入中..." : `导入 ${pairs.filter((p) => p.enabled).length * rows * cols} 张卡（1 个桌游）`}
        </button>
      </div>
    </main>
  );
}

