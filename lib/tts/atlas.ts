// ============================================================
// TTS 资产管线 — 图集网格切割 + 图片加载/压缩（浏览器 canvas）
// 切割矩形是纯数学（可 tsx 单测）；像素导出依赖 canvas（S4 端到端验证）
// ============================================================

export interface CellRect {
  sx: number; // 源图裁切 x
  sy: number;
  sw: number; // 格宽（列数均分）
  sh: number;
  col: number;
  row: number;
}

/** 图集网格切割矩形：TTS 图集无缝均分，col/row 从 0 起（行优先 = CardID 展开顺序） */
export function atlasCellRect(
  img: { width: number; height: number },
  cols: number,
  rows: number,
  col: number,
  row: number,
): CellRect {
  const sw = img.width / cols;
  const sh = img.height / rows;
  return {
    sx: Math.floor(col * sw),
    sy: Math.floor(row * sh),
    sw: Math.round(sw),
    sh: Math.round(sh),
    col,
    row,
  };
}

/** 文件 → dataURL（FileReader） */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(`读取失败: ${file.name}`));
    r.readAsDataURL(file);
  });
}

/** dataURL → HTMLImageElement */
export function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = dataUrl;
  });
}

export interface CutOptions {
  maxSide?: number; // 单卡导出最长边上限（默认 480 ≈ BOB 卡牌渲染尺寸的 3~4 倍）
  quality?: number; // JPEG 质量（默认 0.82）
}

/** 图集整体切割：每格独立 dataURL（JPEG——卡面不透明，体积优先） */
export async function cutAtlas(
  img: HTMLImageElement,
  cols: number,
  rows: number,
  opts: CutOptions = {},
): Promise<{ col: number; row: number; dataUrl: string; width: number; height: number }[]> {
  const { maxSide = 480, quality = 0.82 } = opts;
  const out: { col: number; row: number; dataUrl: string; width: number; height: number }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const rect = atlasCellRect(img, cols, rows, col, row);
      const scale = Math.min(1, maxSide / Math.max(rect.sw, rect.sh));
      const cw = Math.max(1, Math.round(rect.sw * scale));
      const ch = Math.max(1, Math.round(rect.sh * scale));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, cw, ch);
      out.push({ col, row, dataUrl: canvas.toDataURL("image/jpeg", quality), width: cw, height: ch });
    }
  }
  return out;
}

export interface SingleImageOptions {
  maxSide?: number; // 默认 2048（版图/token 大图封顶）
  format?: "image/png" | "image/jpeg"; // token 有透明通道用 PNG，版图/地块不透明用 JPEG
  quality?: number;
}

/** 单张图片（token/board/tile）→ 压缩 dataURL */
export async function imageToDataUrl(
  img: HTMLImageElement,
  opts: SingleImageOptions = {},
): Promise<string> {
  const { maxSide = 2048, format = "image/png", quality = 0.85 } = opts;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(format, quality);
}
