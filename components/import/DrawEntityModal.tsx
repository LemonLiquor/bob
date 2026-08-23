"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
// 贴纸导入历史（会话内，最近 12 条；点击直接复用进入放置模式）
type StickerHistory =
  | { id: number; kind: "emoji"; text: string }
  | { id: number; kind: "image"; dataUrl: string };
const HISTORY_LIMIT = 12;
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
  const [emojiInput, setEmojiInput] = useState(""); // 全量 emoji/文字输入
  const [stickerScale, setStickerScale] = useState(0.5); // 贴纸大小 = 画布 min 边 × scale（0.1~4，emoji/图片共用）；scale×100% = 视觉占画布短边比例（100% 填满短边）
  // 画布像素 → CSS 显示换算系数（画布像素 × cssK = CSS px；勿用 1/SCALE——显示尺寸与分辨率独立）
  const cssK = (SCALE * size.height) / DISPLAY_H;
  const fileRef = useRef<HTMLInputElement>(null); // 导入图片文件选择器
  // 贴纸导入历史（会话内）：emoji/图片最近使用，点击复用
  const [stickerHistory, setStickerHistory] = useState<StickerHistory[]>([]);
  const historyIdRef = useRef(0);
  // 放置模式：选贴纸后预览（半透明虚线框），拖动/滚轮调整，确认才固化位图
  const [placing, setPlacing] = useState<
    | { type: "emoji"; text: string }
    | { type: "image"; img: HTMLImageElement; url: string }
    | null
  >(null);
  const [placeRect, setPlaceRect] = useState({ x: 0, y: 0, w: 0, h: 0 }); // 画布像素坐标
  const dragRef = useRef<{ sx: number; sy: number; rx: number; ry: number } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null); // 预览外层（虚线框 + wheel 监听）
  const previewCanvasRef = useRef<HTMLCanvasElement>(null); // 预览画布（与最终渲染同一绘制代码）
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

  /** 内容源统一入口：压撤销栈（渲染前）→ 按给定矩形执行渲染。
   *  现在承载 emoji（fillText）/ 本地图片（drawImage）；在线图片 = 同构闭包，工具链零改动 */
  function stampToCanvas(
    rect: { x: number; y: number; w: number; h: number },
    render: (ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }) => void,
  ) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    pushUndo();
    render(ctx, rect);
  }

  /** 初始贴纸矩形：画布中心，长边 = 画布 min 边 × 当前大小比例 */
  function initPlaceRect(w: number, h: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const target = Math.min(canvas.width, canvas.height) * stickerScale;
    const scale = target / Math.max(w, h);
    const nw = w * scale;
    const nh = h * scale;
    setPlaceRect({ x: (canvas.width - nw) / 2, y: (canvas.height - nh) / 2, w: nw, h: nh });
  }

  /** 记录导入历史（去重，新在前，上限 12 条）；显式联合参数（Omit 会破坏判别） */
  function addHistory(item: { kind: "emoji"; text: string } | { kind: "image"; dataUrl: string }) {
    const id = historyIdRef.current++;
    const entry: StickerHistory =
      item.kind === "emoji" ? { id, kind: "emoji", text: item.text } : { id, kind: "image", dataUrl: item.dataUrl };
    setStickerHistory((prev) => {
      const dup = prev.some(
        (h) =>
          (h.kind === "emoji" && entry.kind === "emoji" && h.text === entry.text) ||
          (h.kind === "image" && entry.kind === "image" && h.dataUrl === entry.dataUrl),
      );
      if (dup) return prev;
      return [entry, ...prev].slice(0, HISTORY_LIMIT);
    });
  }

  /** 点击历史：emoji 直接进入放置；图片重新加载（dataURL，revoke 是 no-op 安全） */
  function placeHistory(item: StickerHistory) {
    if (item.kind === "emoji") {
      startEmojiPlace(item.text);
    } else {
      const img = new Image();
      img.onload = () => {
        initPlaceRect(img.width, img.height);
        setPlacing({ type: "image", img, url: item.dataUrl });
      };
      img.src = item.dataUrl;
    }
  }

  /** 进入放置模式：emoji/文字（方形初始） */
  function startEmojiPlace(text: string) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    addHistory({ kind: "emoji", text });
    initPlaceRect(1, 1); // emoji 方形：w==h=min×scale
    setPlacing({ type: "emoji", text });
  }

  /** 进入放置模式：本地图片（保持宽高比） */
  function handleImageFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 清空以允许重复选择同一文件
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      initPlaceRect(img.width, img.height);
      setPlacing({ type: "image", img, url }); // url 保留：预览 <img> 依赖它，放置/取消后才 revoke
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
    // 历史：FileReader 存 dataURL（跨会话可复用，不依赖 objectURL 生命周期）
    const reader = new FileReader();
    reader.onload = () => addHistory({ kind: "image", dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  /** 大小精确设置（px 输入）：改宽 → 高按比例跟随（emoji 方形 w==h）；同步 scale 与中心锚定 */
  function changePlaceSize(v: number, axis: "w" | "h") {
    const canvas = canvasRef.current;
    if (!canvas || !placing) return;
    const minDesk = Math.min(size.width, size.height); // 画布短边（桌面 px）
    const vClamped = Math.max(4, Math.min(minDesk * 4, v));
    const vw = axis === "w" ? vClamped : Math.round(vClamped * (placeRect.w / placeRect.h));
    const vh = axis === "h" ? vClamped : Math.round(vClamped * (placeRect.h / placeRect.w));
    const nw = vw * SCALE;
    const nh = vh * SCALE;
    setPlaceRect((r) => ({ x: r.x + (r.w - nw) / 2, y: r.y + (r.h - nh) / 2, w: nw, h: nh }));
    setStickerScale(nw / (Math.min(canvas.width, canvas.height)));
  }

  /** 预览拖动：记录起点与初始矩形（window move/up 在放置 effect 里） */
  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, rx: placeRect.x, ry: placeRect.y };
  }

  /** 取消放置：释放图片 objectURL（预览 <img> 已卸载） */
  const cancelPlace = useCallback(() => {
    if (placing?.type === "image") URL.revokeObjectURL(placing.url);
    setPlacing(null);
  }, [placing]);

  /** 确认放置：一次性固化到画布（一个撤销步），贴纸与笔画同层 */
  function confirmPlace() {
    if (!placing) return;
    const rect = placeRect;
    stampToCanvas(rect, (ctx, r) => {
      if (placing.type === "emoji") {
        ctx.font = `${r.h}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(placing.text, r.x + r.w / 2, r.y + r.h / 2);
      } else {
        ctx.drawImage(placing.img, r.x, r.y, r.w, r.h);
      }
    });
    if (placing.type === "image") URL.revokeObjectURL(placing.url);
    setPlacing(null);
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
      // 放置模式锁绘制（预览层挡住中心，画布边缘也不误画）
      if (placing) return;
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
  }, [color, brush, eraser, fillMode, placing]);

  // 放置模式：拖动（window move/up）+ 滚轮缩放（原生 passive:false 才能 preventDefault）+ ESC 取消
  useEffect(() => {
    if (!placing) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const canvas = canvasRef.current;
      const W = canvas?.width ?? Infinity;
      const H = canvas?.height ?? Infinity;
      setPlaceRect((r) => {
        // 位移 × cssK 换算画布像素；clamp 中心在画布内（防拖飞出画布）
        const nx = Math.max(-r.w / 2, Math.min(W - r.w / 2, d.rx + (e.clientX - d.sx) * cssK));
        const ny = Math.max(-r.h / 2, Math.min(H - r.h / 2, d.ry + (e.clientY - d.sy) * cssK));
        return { ...r, x: nx, y: ny };
      });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelPlace();
    };
    const onWheel = (e: Event) => {
      e.preventDefault();
      const we = e as WheelEvent;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const min = Math.min(canvas.width, canvas.height);
      setPlaceRect((r) => {
        const nw = Math.max(8, Math.min(r.w * (we.deltaY < 0 ? 1.1 : 1 / 1.1), min * 4));
        const nh = nw * (r.h / r.w); // 保持宽高比
        return { x: r.x + (r.w - nw) / 2, y: r.y + (r.h - nh) / 2, w: nw, h: nh };
      });
      setStickerScale((s) => Math.max(0.1, Math.min(4, s * (we.deltaY < 0 ? 1.1 : 1 / 1.1))));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    const el = previewRef.current;
    el?.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      el?.removeEventListener("wheel", onWheel);
    };
  }, [placing, size, cssK, cancelPlace]);

  // 预览重绘：与最终渲染同一绘制代码（fillText/drawImage 同参数）→ 预览 = 渲染的精确预览，零偏移
  useEffect(() => {
    const c = previewCanvasRef.current;
    if (!c || !placing) return;
    c.width = Math.max(1, Math.round(placeRect.w));
    c.height = Math.max(1, Math.round(placeRect.h));
    const ctx = c.getContext("2d")!;
    if (placing.type === "emoji") {
      ctx.font = `${c.height}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(placing.text, c.width / 2, c.height / 2);
    } else {
      ctx.drawImage(placing.img, 0, 0, c.width, c.height);
    }
  }, [placing, placeRect]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div
        className="bg-card border-2 border-ink p-5 w-full max-w-3xl flex flex-col max-h-[92vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：标题 + 操作按钮（固定） */}
        <div className="flex items-start justify-between mb-3 shrink-0">
          <div>
            <h3 className="text-lg font-bold mb-1">手绘实体</h3>
            <p className="text-xs text-secondary">透明背景，导出分辨率 = 尺寸 × 4；形状由笔画像素决定</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost text-sm" onClick={onClose}>
              取消
            </button>
            <button className="btn-pop text-sm" onClick={handleDone}>
              完成
            </button>
          </div>
        </div>

        {/* 左右分栏：左 = 画布区（固定），右 = 工具 + 功能区（flex-1） */}
        <div className="flex gap-4 flex-1 min-h-0">
          {/* 左列：kind / 尺寸 / 画布（固定，不被功能区顶动） */}
          <div className="flex flex-col shrink-0">
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
                setPlacing(null); // 画布重建，取消未放置的贴纸
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

        {/* 画布 + 放置预览层（预览不碰主画布像素；确认时才固化） */}
        <div className="flex justify-center">
          <div
            className="relative overflow-hidden border-2 border-ink" // border 在容器上：预览坐标与画布内容原点对齐（canvas 无 border，避免 2px 错位）
            style={{ width: DISPLAY_H * (size.width / size.height), height: DISPLAY_H }}
          >
            <canvas
              ref={canvasRef}
              className="touch-none"
              style={{
                width: "100%",
                height: "100%",
                background: "var(--surface)",
                cursor: fillMode ? "pointer" : "crosshair",
              }}
            />
            {/* 预览层：外层虚线框（outline 不占盒空间）+ canvas（与最终渲染同一绘制代码，零偏移） */}
            {placing && (
              <div
                ref={previewRef}
                onPointerDown={startDrag}
                className="absolute opacity-75 outline-2 outline-dashed outline-ink cursor-move z-10"
                style={{
                  left: placeRect.x / cssK,
                  top: placeRect.y / cssK,
                  width: placeRect.w / cssK,
                  height: placeRect.h / cssK,
                }}
              >
                <canvas ref={previewCanvasRef} className="w-full h-full" />
              </div>
            )}
          </div>
        </div>
        </div>

        {/* 右列：工具行 + 功能区槽位（flex-1，内容滚动） */}
        <div className="flex flex-col flex-1 min-h-0">
        {/* 工具行：颜色 / 粗细 / 橡皮 / 填色 / 撤销 / 清空（贴纸面板常驻下方槽位） */}
        <div className="flex items-center gap-3 mb-3 flex-wrap shrink-0">
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
          <button className="text-xs px-3 py-1.5 border-2 border-ink/40 hover:border-ink cursor-pointer" onClick={undo}>
            撤销
          </button>
          <button className="text-xs px-3 py-1.5 border-2 border-ink/40 hover:border-ink cursor-pointer" onClick={clear}>
            清空
          </button>
        </div>

        {/* 功能区槽位：贴纸 / 放置区固定占位（flex-1 内容滚动；未来切换收起只影响本区，画布/工具行不动） */}
        <div className="flex-1 min-h-0 overflow-y-auto mb-4 border-2 border-ink p-2 bg-card">
          {placing ? (
            <div className="flex flex-col gap-2">
              {/* 放置条：精确大小输入（px，宽高比例锁定）+ 提示·按钮 */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-secondary whitespace-nowrap">大小 (px)</span>
                {placing.type === "emoji" ? (
                  <label className="text-xs text-secondary flex items-center gap-1">
                    边长
                    <input
                      type="number"
                      min={4}
                      max={Math.round(Math.min(size.width, size.height) * 4)}
                      className="input-pop w-16 px-2 py-1"
                      value={Math.round(placeRect.w / SCALE)}
                      onChange={(e) => changePlaceSize(Number(e.target.value) || 4, "w")}
                    />
                  </label>
                ) : (
                  <>
                    <label className="text-xs text-secondary flex items-center gap-1">
                      宽
                      <input
                        type="number"
                        min={4}
                        max={Math.round(Math.min(size.width, size.height) * 4)}
                        className="input-pop w-16 px-2 py-1"
                        value={Math.round(placeRect.w / SCALE)}
                        onChange={(e) => changePlaceSize(Number(e.target.value) || 4, "w")}
                      />
                    </label>
                    <label className="text-xs text-secondary flex items-center gap-1">
                      高
                      <input
                        type="number"
                        min={4}
                        max={Math.round(Math.min(size.width, size.height) * 4)}
                        className="input-pop w-16 px-2 py-1"
                        value={Math.round(placeRect.h / SCALE)}
                        onChange={(e) => changePlaceSize(Number(e.target.value) || 4, "h")}
                      />
                    </label>
                  </>
                )}
                <span className="text-[11px] text-muted">{Math.round(stickerScale * 100)}%（画布短边）</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted">拖动调位置 · 滚轮调大小</span>
                <div className="flex gap-2">
                  <button className="btn-pop text-xs px-3 py-1.5" onClick={confirmPlace}>
                    放置
                  </button>
                  <button className="btn-ghost text-xs px-3 py-1.5" onClick={cancelPlace}>
                    取消
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* 贴纸面板（统一内容源：emoji 全量输入 / 精选 / 默认大小 / 导入图片） */}
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
                    startEmojiPlace(v);
                    setEmojiInput("");
                  }
                }
              }}
            />
            {/* 导入历史：最近用过的贴纸，点击复用（预制 emoji 已移除） */}
            {stickerHistory.length === 0 ? (
              <p className="text-[11px] text-muted">暂无导入历史 —— 输入 emoji 或导入图片后自动记录</p>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                {stickerHistory.map((h) =>
                  h.kind === "emoji" ? (
                    <button
                      key={h.id}
                      className="text-2xl leading-none py-0.5 hover:bg-ink/10 cursor-pointer"
                      onClick={() => placeHistory(h)}
                    >
                      {h.text}
                    </button>
                  ) : (
                    <button
                      key={h.id}
                      className="hover:bg-ink/10 cursor-pointer flex items-center justify-center p-0.5"
                      onClick={() => placeHistory(h)}
                    >
                      <img src={h.dataUrl} alt="" className="max-h-8 max-w-full object-contain" />
                    </button>
                  ),
                )}
              </div>
            )}
            {/* 默认大小（px，进入放置后的初始边长；放置条可再精确调整） */}
            <div className="flex items-center gap-2 text-xs text-secondary">
              <span>默认大小</span>
              <input
                type="number"
                min={Math.round(Math.min(size.width, size.height) * 0.1)}
                max={Math.round(Math.min(size.width, size.height) * 4)}
                className="input-pop w-16 px-2 py-1"
                value={Math.round(Math.min(size.width, size.height) * stickerScale)}
                onChange={(e) => {
                  const minDesk = Math.min(size.width, size.height);
                  const v = Number(e.target.value) || minDesk * 0.1;
                  setStickerScale(Math.max(0.1, Math.min(4, v / minDesk)));
                }}
              />
              <span className="text-[11px] text-muted">px</span>
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
        </div>
        </div>
      </div>
    </div>
    </div>
  );
}
