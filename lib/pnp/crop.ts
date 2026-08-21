// ============================================================
// PnP 裁切 — 网格裁切（手动边距/间隔参数）+ 双面打印镜像配对 + 卡组摊平
// ============================================================

import type { EntityState, Pile, Prefab, Sprite } from "../engine/types";

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
// ============================================================
// 实体组摊平 — 页面内临时实体组结构 → prefabs / entities / piles
// ============================================================

/** 实体组（页面内临时结构，不进协议/存储）：每组一个牌堆，每项引用图片池 sprite id */
export interface EntityGroup {
  items: { frontSpriteId: string; backSpriteId: string }[]; // backSpriteId 空串 = 默认卡背
  singleFace?: boolean; // 组级：单面实体（正反面一样）→ prefab singleFace: true 且 back 空
}

/**
 * 圆形遮罩：dataURL → 透明背景圆形 PNG（取图时定形状）。
 * 画布 = min(宽,高) 正方形，图居中裁切，圆外透明。
 */
export async function toCircular(dataUrl: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });
  const size = Math.min(img.width, img.height);
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, (size - img.width) / 2, (size - img.height) / 2);
  return c.toDataURL("image/png");
}

/**
 * 实体组摊平为引擎数据：
 * - prefabs：每项一个，id `prefab-{n}` 连续；单面组 → singleFace: true 且 back 空；
 *   sizes 中按正面 spriteId 查到渲染尺寸 → 带 size，否则缺省（120×168 卡牌）
 * - entities：id `inst-{n}` 连续，坐标全 0（实际位置由牌堆承载，Lab 沙盒可调）
 * - piles：每组一个，id `pile-{ts+gi}`，entityIds 按组内顺序，坐标全 0
 * 只产结构，初始状态坐标由导入页 Lab 沙盒自定义。
 */
export function buildGameFromGroups(
  groups: EntityGroup[],
  sizes?: Map<string, { width: number; height: number }>,
): {
  prefabs: Prefab[];
  entities: EntityState[];
  piles: Pile[];
} {
  const prefabs: Prefab[] = [];
  const entities: EntityState[] = [];
  const piles: Pile[] = [];
  const ts = Date.now();
  let n = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const entityIds: string[] = [];
    for (const item of group.items) {
      const size = sizes?.get(item.frontSpriteId);
      prefabs.push({
        id: `prefab-${n}`,
        faces: { front: item.frontSpriteId, back: group.singleFace ? "" : item.backSpriteId },
        ...(group.singleFace ? { singleFace: true } : {}),
        ...(size ? { size } : {}),
      });
      entities.push({
        id: `inst-${n}`,
        prefabId: `prefab-${n}`,
        faceUp: false,
        x: 0,
        y: 0,
        zIndex: 0,
        ...(size ? { size } : {}), // 实例带尺寸（物理属性：不同尺寸不可堆叠）
        ...(group.singleFace ? { singleFace: true } : {}), // 实例带单面标记（引擎禁翻面）
      });
      entityIds.push(`inst-${n}`);
      n++;
    }
    piles.push({ id: `pile-${ts + gi}`, entityIds, x: 0, y: 0 });
  }
  return { prefabs, entities, piles };
}
