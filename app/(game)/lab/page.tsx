"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameAction, GameState, Prefab, Sprite } from "@/lib/engine/types";
import { applyAction, removeEntity } from "@/lib/engine";
import { setAssets } from "@/lib/assets/cache";
import { buildGameFromGroups, type EntityGroup } from "@/lib/pnp/crop";
import { clearDraft, loadDraft, saveDraft } from "@/lib/storage/draft";
import { send, onMessage } from "@/lib/multiplayer/transport";
import type { ServerMessage } from "@/lib/multiplayer/protocol";
import GameBoard from "@/components/game/GameBoard";
import ImportFlow from "@/components/import/ImportFlow";

// ============================================================
// Lab — 桌游组装工作台（主视图）
// 全屏沙盒（GameBoard 受控、无座），可反复通过弹窗导入多个 PDF 实体，
// 整体组装为一个桌游。切片 3b：工作区 = sprites / prefabs / labState，
// 导入提交 → 摊平（id 从全局计数器续）→ 网格摆位 → 合并。
// ============================================================

/** 新批次牌堆网格摆位（避免叠在旧实体上；col 按已有牌堆数递增） */
const GRID_COLS = 5;
const GRID_ORIGIN = { x: 40, y: 40 };
const GRID_STEP = { x: 300, y: 320 };

/** ImportFlow 提交载荷 */
interface CommitPayload {
  sprites: Sprite[];
  groups: EntityGroup[];
  sizes: Map<string, { width: number; height: number }>;
  fileName: string;
  name: string;
}

/** 提取 id 序号："sprite-12" → 12（无数字返回 -1） */
function seqOf(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : -1;
}

/** id 列表最大序号 +1（恢复草稿时续计数器，防碰撞） */
function nextSeq(ids: string[]): number {
  return ids.reduce((max, id) => Math.max(max, seqOf(id)), -1) + 1;
}

export default function LabPage() {
  const [importOpen, setImportOpen] = useState(false);
  const [name, setName] = useState(""); // 桌游名（首次导入取 PDF 名，切片 4 保存时使用）
  const [sprites, setSprites] = useState<Sprite[]>([]); // 全量累积（跨 PDF）
  const [prefabs, setPrefabs] = useState<Prefab[]>([]); // 全量累积
  const [labState, setLabState] = useState<GameState>({ entities: [], piles: [], seats: [] }); // 布局（坐标随拖摆更新）
  // 全局 id 计数器（页面存活期不重置，跨批次不碰撞）
  const spriteCounterRef = useRef(0);
  const entityCounterRef = useRef(0);
  const pileCounterRef = useRef(0);
  const gameIdRef = useRef<string | null>(null); // 桌游 id：首次导入时固定（保存/上传复用）
  const [restored, setRestored] = useState(false); // 已恢复草稿（显示「丢弃」chip）
  const [uploading, setUploading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false); // 上传确认弹窗
  const [error, setError] = useState<string | null>(null);
  const pendingGameIdRef = useRef<string | null>(null); // 上传中的 gameId（匹配 game_uploaded）
  const router = useRouter();

  // 上传结果：成功（匹配 gameId）→ 清草稿 + 跳转广场；失败 → 恢复可重试
  useEffect(() => {
    const unsub = onMessage((msg: ServerMessage) => {
      if (msg.type === "game_uploaded" && msg.gameId === pendingGameIdRef.current) {
        pendingGameIdRef.current = null;
        void clearDraft();
        router.push("/games");
      } else if (msg.type === "error" && pendingGameIdRef.current) {
        pendingGameIdRef.current = null;
        setUploading(false);
        setError("上传失败，请重试");
      }
    });
    return unsub;
  }, [router]);

  // 挂载：自动恢复草稿（内存 = 唯一事实来源，indexDB 是退出保险）
  useEffect(() => {
    let cancelled = false;
    loadDraft()
      .then((draft) => {
        if (cancelled || !draft) return;
        setName(draft.meta.name);
        setSprites(draft.assets.sprites);
        setPrefabs(draft.assets.prefabs);
        setLabState({ ...draft.initialState, seats: [] });
        gameIdRef.current = draft.meta.id;
        spriteCounterRef.current = nextSeq(draft.assets.sprites.map((s) => s.id));
        entityCounterRef.current = nextSeq(draft.assets.prefabs.map((p) => p.id));
        pileCounterRef.current = nextSeq(draft.initialState.piles.map((p) => p.id));
        setAssets(draft.assets); // 渲染必需（同步）
        setRestored(true);
      })
      .catch(() => {
        /* 无草稿/读取失败：空工作区 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Lab 本地动作：复用引擎（与服务端同分发） */
  function handleLabAction(action: GameAction) {
    setLabState((prev) => applyAction(prev, action));
  }

  /** 导入提交：摊平（id 从全局计数器续）→ 网格摆位 → 合并工作区 */
  function handleCommit({ sprites: batchSprites, groups, sizes, fileName, name: batchName }: CommitPayload) {
    // 桌游名默认取第一个 PDF 文件名（lab 上传弹窗可改）；桌游 id 首次导入时固定
    if (!name.trim()) setName(batchName.trim() || fileName.replace(/\.pdf$/i, ""));
    if (!gameIdRef.current) gameIdRef.current = `pnp-${Date.now()}`;
    const { prefabs: newPrefabs, entities, piles } = buildGameFromGroups(
      groups,
      sizes,
      entityCounterRef.current,
      pileCounterRef.current,
    );
    entityCounterRef.current += entities.length;
    pileCounterRef.current += piles.length;
    // 新牌堆落到确定性网格空位（不叠旧实体）
    const pileCount = labState.piles.length;
    const placedPiles = piles.map((p, i) => {
      const idx = pileCount + i;
      return {
        ...p,
        x: GRID_ORIGIN.x + (idx % GRID_COLS) * GRID_STEP.x,
        y: GRID_ORIGIN.y + Math.floor(idx / GRID_COLS) * GRID_STEP.y,
      };
    });
    setSprites((prev) => [...prev, ...batchSprites]);
    setPrefabs((prev) => [...prev, ...newPrefabs]);
    // 资产入缓存（渲染必需：getPrefabFaces 按 prefabId 查表）——同步先于渲染，避免首帧回退默认样式
    setAssets({ sprites: [...sprites, ...batchSprites], prefabs: [...prefabs, ...newPrefabs] });
    setLabState((prev) => ({
      entities: [...prev.entities, ...entities],
      piles: [...prev.piles, ...placedPiles],
      seats: [],
    }));
  }

  /** 切片 5：保存 → 写入 indexDB 草稿（纯手动，无自动保存） */
  function handleSave() {
    const payload = {
      meta: {
        id: gameIdRef.current ?? `pnp-${Date.now()}`,
        name: name.trim(),
        icon: "🖼️",
      },
      assets: { sprites, prefabs },
      initialState: labState,
    };
    if (!gameIdRef.current) gameIdRef.current = payload.meta.id; // 空桌直接保存：固定 id
    saveDraft(payload).catch((e) => console.error("草稿保存失败", e));
  }

  /** 上传：先弹确认窗检查上传信息（桌游名可编辑 + 实体统计），确认后发送 */
  function handleUpload() {
    if (empty || uploading) return;
    setUploadOpen(true);
  }

  /** 确认上传：组装 meta + assets + 无座 initialState → 原上传链路；成功后清草稿跳广场 */
  function doUpload() {
    if (empty || uploading) return;
    const payload = {
      meta: {
        id: gameIdRef.current ?? `pnp-${Date.now()}`,
        name: name.trim() || "未命名桌游",
        icon: "🖼️",
      },
      assets: { sprites, prefabs },
      initialState: { ...labState, seats: [] }, // 强制无座
    };
    if (!gameIdRef.current) gameIdRef.current = payload.meta.id;
    setUploadOpen(false);
    setUploading(true);
    setError(null);
    pendingGameIdRef.current = payload.meta.id;
    send({ type: "upload_game", meta: payload.meta, assets: payload.assets, initialState: payload.initialState });
  }

  /** 丢弃草稿：清 indexDB + 重置工作区（重新开始组装） */
  async function handleDiscardDraft() {
    try {
      await clearDraft();
    } catch {
      /* 清除失败也重置内存 */
    }
    setRestored(false);
    setName("");
    setSprites([]);
    setPrefabs([]);
    setLabState({ entities: [], piles: [], seats: [] });
    gameIdRef.current = null;
    spriteCounterRef.current = 0;
    entityCounterRef.current = 0;
    pileCounterRef.current = 0;
    setAssets({ sprites: [], prefabs: [] }); // 清缓存防残留渲染
  }

  /** 工作区全局 sprite id 分配（跨批次永不重复） */
  const allocSpriteId = () => `sprite-${spriteCounterRef.current++}`;

  /** Lab 删除（7a）：hover 实体按 Delete → 从工作区移除（引擎 removeEntity：出堆 + ≤1 张散堆） */
  function handleDelete(id: string) {
    setLabState((prev) => removeEntity(prev, id));
  }

  /** Lab 复制（7b）：hover 实体按 Ctrl+D → 同 prefab 新实例（自由，偏移 (24,24)，z 置顶） */
  function handleCopy(id: string) {
    setLabState((prev) => {
      const src = prev.entities.find((e) => e.id === id);
      if (!src) return prev;
      const maxZ = prev.entities.reduce((m, e) => Math.max(m, e.zIndex), 0);
      const copy = {
        ...src,
        id: `inst-${entityCounterRef.current++}`,
        x: src.x + 24,
        y: src.y + 24,
        zIndex: maxZ + 1,
      };
      return { ...prev, entities: [...prev.entities, copy] };
    });
  }

  const empty = labState.entities.length === 0 && labState.piles.length === 0;

  // 实体统计（上传确认窗展示，按 kind 分组）
  const kindCounts = { card: 0, token: 0, board: 0 };
  for (const e of labState.entities) kindCounts[e.kind]++;

  return (
    // (game) 布局已提供 h-screen 高度，GameBoard 的 h-full 直接填满（无 nav，视口坐标 = 桌面坐标）
    <>
      <GameBoard gameState={labState} onAction={handleLabAction} labMode onLabDelete={handleDelete} onLabCopy={handleCopy} />
      {/* 空态提示（不挡交互） */}
      {empty && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-40">
          <p className="text-muted text-lg bg-card border-2 border-ink px-6 py-3">
            空桌 —— 点 [导入 PDF] 开始，可反复导入多个 PDF 组装成一个桌游
          </p>
        </div>
      )}
      {/* 上传失败提示 */}
      {error && (
        <p className="fixed top-3 left-1/2 -translate-x-1/2 z-50 text-red-500 text-xs bg-card border-2 border-red-500 px-2 py-1">
          {error}
        </p>
      )}
      {/* 右上角：草稿恢复提示 + 返回广场 */}
      <div className="fixed top-3 right-3 z-50 flex items-center gap-2">
        {restored && (
          <div className="flex items-center gap-2 bg-card border-2 border-ink px-3 py-1.5">
            <span className="text-[11px] text-muted">草稿已恢复</span>
            <button className="link-pop text-[11px]" onClick={handleDiscardDraft}>
              丢弃
            </button>
          </div>
        )}
        <button className="btn-ghost text-xs" onClick={() => router.push("/games")}>
          ← 广场
        </button>
      </div>
      {/* 浮动控件：保存（indexDB 草稿）+ 上传（发布）+ 导入入口 */}
      <div className="fixed bottom-3 right-3 z-50 flex items-center gap-2">
        <button className="btn-ghost text-xs" onClick={handleSave} disabled={empty}>
          保存
        </button>
        <button className="btn-pop text-xs" onClick={handleUpload} disabled={empty || uploading}>
          {uploading ? "上传中..." : "上传"}
        </button>
        <button className="btn-pop text-xs" onClick={() => setImportOpen(true)}>
          导入 PDF
        </button>
      </div>
      {/* 上传确认弹窗：检查上传信息（桌游名可编辑 + 统计） */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-card border-2 border-ink p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold mb-4">上传桌游</h3>
            <label className="text-xs text-secondary flex flex-col gap-1 mb-4">
              桌游名称
              <input
                className="input-pop w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="我的桌游"
                autoFocus
              />
            </label>
            <div className="text-xs text-secondary flex flex-col gap-1 mb-5">
              <span>
                卡牌 {kindCounts.card} 张 / Token {kindCounts.token} 个 / 版图 {kindCounts.board} 块
              </span>
              <span>图片 {sprites.length} 张</span>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost text-sm" onClick={() => setUploadOpen(false)}>
                取消
              </button>
              <button className="btn-pop text-sm" onClick={doUpload}>
                确认上传
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 导入弹窗：遮罩 + 居中卡片（滚动），四周露出 lab 桌面 */}
      {importOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto">
          <div className="min-h-full flex items-start justify-center py-8 px-4">
            <div className="w-full max-w-4xl bg-card border-2 border-ink">
              <ImportFlow
                onClose={() => setImportOpen(false)}
                allocSpriteId={allocSpriteId}
                onCommit={handleCommit}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
