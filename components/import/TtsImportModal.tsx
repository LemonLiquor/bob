"use client";

import { useRef, useState } from "react";
import { parseTtsSave, type TtsObject } from "@/lib/tts/parse";
import { buildTtsGame, type TtsBuildResult } from "@/lib/tts/build";
import { dataUrlToImage, fileToDataUrl, cutAtlas } from "@/lib/tts/atlas";

// ============================================================
// TtsImportModal — 导入 TTS 图包弹窗（Lab）
// 流程：选 Save JSON + Images 文件夹 → S1 库存报告（确认）→
//       S3 构建（真 canvas 切割 + 压缩）→ onCommit 合入 Lab 工作区
// 文件匹配：TTS 本地缓存命名 = URL 去非字母数字（folder 内按文件名匹配）
// ============================================================

interface TtsImportModalProps {
  onClose: () => void;
  /** 构建完成：把生成的桌游包交给 Lab 合并（Lab 负责 id 重映射与摆位） */
  onCommit: (result: TtsBuildResult, saveName: string) => void;
}

type Phase = "pick" | "parsed" | "building" | "error";

export default function TtsImportModal({ onClose, onCommit }: TtsImportModalProps) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [report, setReport] = useState<{
    decks: number;
    cards: number;
    tokens: number;
    bags: number;
    dice: number;
    counters: number;
    imagesMatched: number;
    imagesMissing: number;
    skipped: Record<string, number>;
  } | null>(null);

  const jsonFileRef = useRef<File | null>(null);
  const imageFilesRef = useRef<File[]>([]);
  const folderInputRef = useRef<HTMLInputElement>(null);

  function pickJson(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    jsonFileRef.current = f;
    setSaveName(f.name.replace(/\.json$/i, ""));
    tryPhaseParse();
  }

  function pickFolder(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
    imageFilesRef.current = files;
    tryPhaseParse();
  }

  /** json + 图片就绪 → S1 解析出报告 */
  function tryPhaseParse() {
    const json = jsonFileRef.current;
    if (!json || imageFilesRef.current.length === 0) return;
    setPhase("parsed");
    setReport(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const save = JSON.parse(String(reader.result));
        const inv = parseTtsSave(save as { SaveName?: string; ObjectStates?: TtsObject[] }, imageFilesRef.current.map((f) => f.name));
        setReport({
          decks: inv.decks.length,
          cards: inv.importable.cards + inv.importable.decks,
          tokens: inv.importable.tokens + inv.importable.tiles,
          bags: inv.importable.bags,
          dice: inv.importable.dice,
          counters: inv.importable.counters,
          imagesMatched: inv.images.matched,
          imagesMissing: inv.images.missing.length,
          skipped: inv.skipped,
        });
        saveObjRef.current = save;
      } catch (err) {
        setPhase("error");
        setError(`解析失败：${String(err)}`);
      }
    };
    reader.onerror = () => {
      setPhase("error");
      setError("Save 文件读取失败");
    };
    reader.readAsText(json);
  }

  const saveObjRef = useRef<{ SaveName?: string; ObjectStates?: TtsObject[] } | null>(null);

  /** 确认导入：加载匹配图片 → S3 构建（真 canvas）→ onCommit */
  async function handleImport() {
    const save = saveObjRef.current;
    if (!save) return;
    setPhase("building");
    setError(null);
    try {
      // 图片装载：拍平 key（无扩展名小写）→ dataURL + 尺寸
      const images = new Map<string, { dataUrl: string; width: number; height: number; element: HTMLImageElement }>();
      await Promise.all(
        imageFilesRef.current.map(async (f) => {
          const dataUrl = await fileToDataUrl(f);
          const el = await dataUrlToImage(dataUrl);
          const key = f.name.replace(/\.(png|jpe?g|webp)$/i, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
          images.set(key, { dataUrl, width: el.naturalWidth, height: el.naturalHeight, element: el });
        }),
      );
      const deps = {
        images,
        cutAtlas: (src: { element: HTMLImageElement }, cols: number, rows: number) =>
          cutAtlas(src.element, cols, rows, { maxSide: 480, quality: 0.82 }),
      };
      const result = await buildTtsGame(
        save as never,
        deps as never,
      );
      setPhase("pick");
      onCommit(result, save.SaveName ?? "TTS 图包");
      onClose();
    } catch (err) {
      setPhase("error");
      setError(`构建失败：${String(err)}`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="panel-pop p-6 min-w-[420px] max-w-[560px]" onClick={(e) => e.stopPropagation()}>
        <p className="text-lg font-bold mb-1">导入 TTS 图包</p>
        <p className="text-[11px] text-muted mb-4">选择 Tabletop Simulator 的 Save JSON 与 Mods/Images 文件夹，自动转换为桌游</p>

        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">① Save JSON 文件（Workshop/xxx.json 或存档）</span>
            <input type="file" accept=".json" onChange={pickJson} className="text-xs" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">② Mods/Images 文件夹（整个文件夹）</span>
            <input
              type="file"
              ref={folderInputRef}
              onChange={pickFolder}
              // @ts-expect-error webkitdirectory 为非标准属性
              webkitdirectory=""
              className="text-xs"
            />
          </label>

          {report && (
            <div className="border-2 border-ink rounded p-3 text-xs bg-card">
              <p className="font-bold mb-1">库存报告：{saveName}</p>
              <p>牌堆图集 {report.decks} 套 · 卡牌 {report.cards} 张 · token/地块 {report.tokens}</p>
              <p>袋 {report.bags}（→ 牌堆）· 骰子 {report.dice} · 计数器 {report.counters}（→ 数字牌）</p>
              <p className={report.imagesMissing ? "text-red-500" : ""}>
                图片匹配 {report.imagesMatched}{report.imagesMissing ? ` / 缺失 ${report.imagesMissing}` : " ✓"}
              </p>
              {Object.keys(report.skipped).length > 0 && (
                <p className="text-muted mt-1">跳过（3D/装饰）：{Object.entries(report.skipped).map(([k, v]) => `${k}×${v}`).join("、")}</p>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
          {phase === "building" && <p className="text-xs text-secondary">构建中（切割图集 + 生成桌游包）……</p>}

          <div className="flex gap-2 justify-end">
            <button className="btn-ghost text-sm" onClick={onClose}>取消</button>
            <button className="btn-pop text-sm" disabled={!report || phase === "building"} onClick={handleImport}>
              {phase === "building" ? "构建中……" : "导入到 Lab"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
