// ============================================================
// PnP 裁切 — 网格裁切（手动边距/间隔参数）+ 双面打印镜像配对 + 资产生成
// ============================================================

import type { GameAssets, Prefab, Sprite } from "../engine/types";
import type { UploadGameMeta } from "../multiplayer/protocol";

/** 裁切配置（单位：canvas 像素，pdf.js scale 2 渲染） */
export interface CropConfig {
  marginTop: number;    // 页眉边距
  marginBottom: number; // 页尾边距
  marginLeft: number;   // 左边距
  marginRight: number;  // 右边距
  gapX: number;         // 牌与牌水平间隔
  gapY: number;         // 牌与牌垂直间隔
}

export const DEFAULT_CROP: CropConfig = {
  marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
  gapX: 0, gapY: 0,
};

/**
 * 将整页 canvas 裁切为 rows×cols 张卡，返回行优先的 dataURL 数组。
 * 顺序：第 0 行左→右，第 1 行左→右，...
 * 布局：可用区域 = 整页去掉四边距；每格 = (可用区 - 间隔) 等分。
 */
export function cropGrid(
  canvas: HTMLCanvasElement,
  rows: number,
  cols: number,
  cfg: CropConfig = DEFAULT_CROP,
): string[] {
  const { marginTop, marginBottom, marginLeft, marginRight, gapX, gapY } = cfg;
  const usableW = canvas.width - marginLeft - marginRight;
  const usableH = canvas.height - marginTop - marginBottom;
  const cellW = (usableW - gapX * (cols - 1)) / cols;
  const cellH = (usableH - gapY * (rows - 1)) / rows;
  const out: string[] = [];

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const x = marginLeft + j * (cellW + gapX);
      const y = marginTop + i * (cellH + gapY);
      const c = document.createElement("canvas");
      c.width = Math.floor(cellW);
      c.height = Math.floor(cellH);
      const ctx = c.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(
        canvas,
        x, y, cellW, cellH,
        0, 0, c.width, c.height,
      );
      out.push(c.toDataURL("image/jpeg", 0.8));
    }
  }
  return out;
}

/**
 * 双面打印镜像：正面第 i 行第 j 列 ↔ 背面第 i 行第 (cols-1-j) 列。
 * 参数均为 0-based 行优先序号数组（cropGrid 输出）。
 */
export function mirrorBackIndex(frontIndex: number, cols: number): number {
  const row = Math.floor(frontIndex / cols);
  const col = frontIndex % cols;
  return row * cols + (cols - 1 - col);
}

/** 单页对：正面裁切结果 + 背面裁切结果（null = 用默认卡背） */
export interface PagePairData {
  frontDataUrls: string[];
  backDataUrls: string[] | null;
}

export interface BuildPnpMultiParams {
  name: string;
  cols: number;
  pagePairs: PagePairData[];  // 多页正反交替 PDF：每页对一组，全部合成一个桌游
}

/**
 * 生成 PnP 资产（内存生成，不落盘）——多页对合成一个桌游（编译级适配）：
 * - 每张卡正面 → 一个 sprite；有背面（镜像配对）→ 各自一个背面 sprite
 * - 每张卡 → 一个 prefab（faces 引用对应 sprite；无背面 → back 空串，渲染回退默认卡背）
 * - 只产 meta + 资产，初始状态由客户端 buildGame 派生
 * - 注意：导入侧重做（每页对 → 多牌堆/共用背面）留待后续需求
 */
export async function buildPnpAssetsMulti(params: BuildPnpMultiParams): Promise<{ meta: UploadGameMeta; assets: GameAssets }> {
  const { name, cols, pagePairs } = params;
  const gameId = `pnp-${Date.now()}`;
  const sprites: Sprite[] = [];
  const prefabs: Prefab[] = [];
  let n = 0;

  for (const pair of pagePairs) {
    pair.frontDataUrls.forEach((frontUrl, k) => {
      sprites.push({ id: `sprite-f${n}`, url: frontUrl });
      const backUrl = pair.backDataUrls ? pair.backDataUrls[mirrorBackIndex(k, cols)] : undefined;
      if (backUrl) {
        sprites.push({ id: `sprite-b${n}`, url: backUrl });
      }
      prefabs.push({
        id: `prefab-c${n}`,
        faces: { front: `sprite-f${n}`, back: backUrl ? `sprite-b${n}` : "" },
      });
      n++;
    });
  }

  return { meta: { id: gameId, name, icon: "🖼️" }, assets: { sprites, prefabs } };
}
