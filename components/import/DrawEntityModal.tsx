"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { EntityKind, Size } from "@/lib/engine/types";

// ============================================================
// DrawEntityModal — 手绘桌游实体弹窗
// - 画布透明背景（形状由笔画像素承载，复用"形状在取图时定"机制，无 shape 字段）
// - 像素分辨率 = 导出尺寸 × 4（几何锯齿 + 线条实心像素支撑）
// - 尺寸输入比例锁定（改宽 → 高按当前比例跟随；画布等比缩放保留内容，防拉伸）
// - kind 决定能力（card 默认卡背 / token 单面可叠 / board 可旋转）
// ============================================================

const KIND_PRESETS: Record<EntityKind, { size: Size; label: string }> = {
  card: { size: { width: 120, height: 168 }, label: "卡牌 5:7" },
  token: { size: { width: 80, height: 80 }, label: "Token 1:1" },
  board: { size: { width: 240, height: 240 }, label: "版图 1:1" },
};

const COLORS = ["#1a1a1a", "#e63946", "#457b9d", "#2e7d32", "#f2c200", "#ffffff"];
const BRUSH_SIZES = [1, 2, 4]; // 视觉（桌面）像素；画布实际 = 视觉 × SCALE（整数，避免 AA 不对称）
const SCALE = 4; // 像素分辨率 = 导出尺寸 × 4
const UNDO_LIMIT = 20;
const FILL_TOLERANCE = 32; // 填色匹配容差
const FILL_ALPHA_THRESHOLD = 96; // 填色：alpha ≤ 阈值视为空白（把笔画 AA 边缘补成填充色，不留毛边）
// 内容源之一：emoji 贴纸（精选快捷入口；全量 = 输入框任意字符，见面板）
// 后续在线图片 = 复用文本输入框（URL → Image），注意跨域 CORS 与 canvas 污染
const EMOJIS = [
  "🎲", "🐴", "🃏", "⚔️", "🛡️", "👑", "💎", "💰", "⭐", "❤️",
  "🔥", "💧", "🌙", "☀️", "🌈", "🍀", "🏆", "🥇", "📦", "🗝️",
  "🏰", "🐉", "🦄", "🐺", "🦊", "🐻", "🍎", "⚡", "❄️", "🌲",
];
const DISPLAY_H = 320; // 画布显示高度（CSS px），宽按比例
const SIZE_MIN = 16;
const SIZE_MAX = 480;

/** hex → rgba（填色用，alpha 恒 255 不透明） */
function hexToRgba(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255 };
}

/** 扫描线 flood fill（栈式 4-邻域，避免递归栈溢出）：匹配容差内像素替换为 fill 色，返回修改像素数 */
function floodFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fill: { r: number; g: number; b: number; a: number },
  tolerance: number,
): number {
  const { width, height } = ctx.canvas;
  const img = ctx.getImageData(0, 0, width, height);
  const data = img.data;
  const i0 = (y * width + x) * 4;
  const tr = data[i0];
  const tg = data[i0 + 1];
  const tb = data[i0 + 2];
  const ta = data[i0 + 3];
  // 目标点已同色 → 无需填充
  if (
    Math.abs(tr - fill.r) <= tolerance &&
    Math.abs(tg - fill.g) <= tolerance &&
    Math.abs(tb - fill.b) <= tolerance &&
    Math.abs(ta - fill.a) <= tolerance
  ) {
    return 0;
  }
  const match = (i: number) =>
    // 半透明边缘（笔画 AA）视为空白：填色时补齐，边缘不留渐变残留
    data[i + 3] <= FILL_ALPHA_THRESHOLD ||
    (Math.abs(data[i] - tr) <= tolerance &&
      Math.abs(data[i + 1] - tg) <= tolerance &&
      Math.abs(data[i + 2] - tb) <= tolerance &&
      Math.abs(data[i + 3] - ta) <= tolerance);
  let changed = 0;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [x, y];
  while (stack.length) {
    const py = stack.pop()!;
    const px = stack.pop()!;
    if (px < 0 || px >= width || py < 0 || py >= height) continue;
    const vi = py * width + px;
    if (visited[vi]) continue;
    visited[vi] = 1;
    const i = vi * 4;
    if (!match(i)) continue;
    data[i] = fill.r;
    data[i + 1] = fill.g;
    data[i + 2] = fill.b;
    data[i + 3] = fill.a;
    changed++;
    stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
  }
  if (changed > 0) ctx.putImageData(img, 0, 0);
  return changed;
}

interface DrawEntityModalProps {
  onClose: () => void;
  onCreate: (data: { url: string; kind: EntityKind; size: Size }) => void;
}

export default function DrawEntityModal({ onClose, onCreate }: DrawEntityModalProps) {
  const [kind, setKind] = useState<EntityKind>("token");
  const [size, setSize] = useState<Size>(KIND_PRESETS.token.size);
  const [color, setColor] = useState(COLORS[0]);
  const [brush, setBrush] = useState(BRUSH_SIZES[1]);
  const [eraser, setEraser] = useState(false);
  const [fillMode, setFillMode] = useState(false); // 填色模式：点击即填充当前颜色
  const [emojiOpen, setEmojiOpen] = useState(false); // emoji 贴纸面板
  const [emojiInput, setEmojiInput] = useState(""); // 全量 emoji/文字输入
  const [stickerScale, setStickerScale] = useState(0.5); // 贴纸大小 = 画布 min 边 × scale（emoji/图片共用）
  const fileRef = useRef<HTMLInputElement>(null); // 导入图片文件选择器
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const prevKindRef = useRef<EntityKind>(kind);

  // 压栈（笔触结束 / 清空前）；上限 20 步，尺寸重建后清空
  function pushUndo() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.shift();
  }

  function undo() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const data = undoStackRef.current.pop();
    if (!data) return;
    canvas.getContext("2d")!.putImageData(data, 0, 0);
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    pushUndo(); // 清空可撤销
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
  }

  /** 内容源统一入口：压撤销栈（渲染前）→ 以画布中心为锚点执行渲染。
   *  现在承载 emoji（fillText）；未来导入图片 = drawImage 闭包，工具链零改动 */
  function stampToCanvas(render: (ctx: CanvasRenderingContext2D, cx: number, cy: number) => void) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    pushUndo();
    render(ctx, canvas.width / 2, canvas.height / 2);
  }

  /** 盖 emoji/文字：彩色系统字体渲染到画布中心（emoji 是彩色像素 → 填色不误吃、橡皮可擦、导出透明 PNG） */
  function handleEmoji(emoji: string) {
    stampToCanvas((ctx, cx, cy) => {
      const size = Math.min(ctx.canvas.width, ctx.canvas.height) * stickerScale;
      ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(emoji, cx, cy);
    });
    setEmojiOpen(false);
  }

  /** 导入本地图片：等比缩放（长边 = 画布 min 边 × 大小比例）贴画布中心；与 emoji 同构走 stampToCanvas */
  function handleImageFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 清空以允许重复选择同一文件
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      stampToCanvas((ctx, cx, cy) => {
        const target = Math.min(ctx.canvas.width, ctx.canvas.height) * stickerScale;
        const scale = target / Math.max(img.width, img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  /** 完成：导出透明 PNG（分辨率 = 尺寸 × 4） */
  function handleDone() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onCreate({ url: canvas.toDataURL("image/png"), kind, size });
  }

  // 画布分辨率跟随 size × SCALE；kind 切换清空，尺寸变化等比缩放保留内容
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = size.width * SCALE;
    const h = size.height * SCALE;
    if (canvas.width === w && canvas.height === h) return;
    const keep = prevKindRef.current === kind; // 仅尺寸变化保留
    const temp = document.createElement("canvas");
    temp.width = canvas.width;
    temp.height = canvas.height;
    temp.getContext("2d")!.drawImage(canvas, 0, 0);
    canvas.width = w;
    canvas.height = h;
    if (keep) canvas.getContext("2d")!.drawImage(temp, 0, 0, w, h); // 比例锁定 → 等比拉伸不变形
    undoStackRef.current = [];
    prevKindRef.current = kind;
  }, [size, kind]);

  // 绘制：pointerdown 起笔（canvas），move/up 监听 window（拖出画布不断线）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const toCanvas = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    };
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      const p = toCanvas(e);
      // 填色模式：点击填充（实际修改了像素才压栈），不进入画笔拖拽
      if (fillMode) {
        const changed = floodFill(ctx, Math.floor(p.x), Math.floor(p.y), hexToRgba(color), FILL_TOLERANCE);
        if (changed > 0) pushUndo();
        return;
      }
      drawingRef.current = true;
      lastRef.current = p;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    };
    const onMove = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      const p = toCanvas(e);
      const last = lastRef.current;
      if (!last) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = brush * SCALE; // 笔粗 = 视觉 px × SCALE（恒整数）
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastRef.current = p;
    };
    const onUp = () => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      lastRef.current = null;
      pushUndo();
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [color, brush, eraser, fillMode]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div
        className="bg-card border-2 border-ink p-5 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-1">手绘实体</h3>
        <p className="text-xs text-secondary mb-3">透明背景，导出分辨率 = 尺寸 × 2；形状由笔画像素决定</p>

        {/* kind 选择 */}
        <div className="flex gap-1.5 mb-3">
          {(Object.keys(KIND_PRESETS) as EntityKind[]).map((k) => (
            <button
              key={k}
              className={`text-xs px-3 py-1.5 border-2 cursor-pointer ${
                kind === k ? "bg-ink text-surface border-ink" : "border-ink/40 hover:border-ink"
              }`}
              onClick={() => {
                setKind(k);
                setSize(KIND_PRESETS[k].size);
              }}
            >
              {KIND_PRESETS[k].label}
            </button>
          ))}
        </div>

        {/* 尺寸输入（比例锁定：改宽 → 高按当前比例跟随） */}
        <div className="flex items-center gap-2 mb-3 text-xs text-secondary">
          <span>尺寸</span>
          <input
            type="number"
            min={SIZE_MIN}
            max={SIZE_MAX}
            className="input-pop w-20 px-2 py-1"
            value={size.width}
            onChange={(e) => {
              const w = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Number(e.target.value) || SIZE_MIN));
              setSize({ width: w, height: Math.round((w * size.height) / size.width) });
            }}
          />
          <span>×</span>
          <input
            type="number"
            min={SIZE_MIN}
            max={SIZE_MAX}
            className="input-pop w-20 px-2 py-1"
            value={size.height}
            onChange={(e) => {
              const h = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Number(e.target.value) || SIZE_MIN));
              setSize({ width: Math.round((h * size.width) / size.height), height: h });
            }}
          />
          <span>px</span>
        </div>

        {/* 画布（米白底仅显示，导出透明） */}
        <div className="flex justify-center mb-3">
          <canvas
            ref={canvasRef}
            className="border-2 border-ink touch-none"
            style={{
              width: DISPLAY_H * (size.width / size.height),
              height: DISPLAY_H,
              background: "var(--surface)",
              cursor: fillMode ? "pointer" : "crosshair",
            }}
          />
        </div>

        {/* 工具行：颜色 / 粗细 / 橡皮 / 填色 / 贴纸 / 撤销 / 清空 */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`w-6 h-6 rounded-full border-2 cursor-pointer transition-transform ${
                  color === c && !eraser && !fillMode ? "border-ink scale-110" : "border-ink/30 hover:border-ink"
                }`}
                style={{ background: c }}
                onClick={() => {
                  setColor(c);
                  setEraser(false);
                  setFillMode(false);
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {BRUSH_SIZES.map((b) => (
              <button
                key={b}
                className={`w-8 h-8 border-2 flex items-center justify-center cursor-pointer ${
                  brush === b && !eraser && !fillMode ? "border-ink bg-ink/10" : "border-ink/30 hover:border-ink"
                }`}
                onClick={() => {
                  setBrush(b);
                  setEraser(false);
                  setFillMode(false);
                }}
              >
                <span className="rounded-full" style={{ width: b * 3, height: b * 3, background: "#1a1a1a" }} />
              </button>
            ))}
          </div>
          <button
            className={`text-xs px-3 py-1.5 border-2 cursor-pointer ${
              eraser ? "bg-ink text-surface border-ink" : "border-ink/40 hover:border-ink"
            }`}
            onClick={() => {
              setEraser((v) => !v);
              setFillMode(false);
            }}
          >
            橡皮
          </button>
          <button
            className={`text-xs px-3 py-1.5 border-2 cursor-pointer ${
              fillMode ? "bg-ink text-surface border-ink" : "border-ink/40 hover:border-ink"
            }`}
            onClick={() => {
              setFillMode((v) => !v);
              setEraser(false);
            }}
          >
            填色
          </button>
          <button
            className={`text-xs px-3 py-1.5 border-2 cursor-pointer ${
              emojiOpen ? "bg-ink text-surface border-ink" : "border-ink/40 hover:border-ink"
            }`}
            onClick={() => setEmojiOpen((v) => !v)}
          >
            贴纸
          </button>
          <button className="text-xs px-3 py-1.5 border-2 border-ink/40 hover:border-ink cursor-pointer" onClick={undo}>
            撤销
          </button>
          <button className="text-xs px-3 py-1.5 border-2 border-ink/40 hover:border-ink cursor-pointer" onClick={clear}>
            清空
          </button>
        </div>

        {/* 贴纸面板（统一内容源：emoji 全量输入 / 精选 / 大小 / 导入图片） */}
        {emojiOpen && (
          <div className="flex flex-col gap-2 mb-4 border-2 border-ink p-2 bg-card">
            {/* 全量入口：任意 emoji 或文字，回车渲染（在线图片 URL 后续复用此框） */}
            <input
              className="input-pop w-full px-2 py-1 text-sm"
              placeholder="输入 emoji 或文字，回车渲染（如 🤖）"
              value={emojiInput}
              onChange={(e) => setEmojiInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = emojiInput.trim();
                  if (v) {
                    handleEmoji(v);
                    setEmojiInput("");
                  }
                }
              }}
            />
            {/* 精选快捷入口 */}
            <div className="grid grid-cols-6 gap-1">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  className="text-2xl leading-none py-0.5 hover:bg-ink/10 cursor-pointer"
                  onClick={() => handleEmoji(e)}
                >
                  {e}
                </button>
              ))}
            </div>
            {/* 大小（emoji 字号与图片缩放共用） */}
            <div className="flex items-center gap-2 text-xs text-secondary">
              <span>大小</span>
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={stickerScale}
                onChange={(e) => setStickerScale(Number(e.target.value))}
                className="flex-1 accent-[var(--ink)]"
              />
              <span className="w-10 text-right">{Math.round(stickerScale * 100)}%</span>
            </div>
            {/* 导入图片（本地文件；在线图片后续扩展） */}
            <div className="flex items-center gap-2">
              <button className="btn-ghost text-xs px-3 py-1.5" onClick={() => fileRef.current?.click()}>
                导入图片
              </button>
              <span className="text-[11px] text-muted">本地图片（png/jpg），在线图片 URL 后续支持</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageFile}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn-ghost text-sm" onClick={onClose}>
            取消
          </button>
          <button className="btn-pop text-sm" onClick={handleDone}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
