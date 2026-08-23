"use client";

import { useEffect, useRef, useState } from "react";
import type { EntityKind, Size } from "@/lib/engine/types";

// ============================================================
// DrawEntityModal — 手绘桌游实体弹窗
// - 画布透明背景（形状由笔画像素承载，复用"形状在取图时定"机制，无 shape 字段）
// - 像素分辨率 = 导出尺寸 × 2（笔触视觉比例 / dataURL 体积的平衡点）
// - 尺寸输入比例锁定（改宽 → 高按当前比例跟随；画布等比缩放保留内容，防拉伸）
// - kind 决定能力（card 默认卡背 / token 单面可叠 / board 可旋转）
// ============================================================

const KIND_PRESETS: Record<EntityKind, { size: Size; label: string }> = {
  card: { size: { width: 120, height: 168 }, label: "卡牌 5:7" },
  token: { size: { width: 80, height: 80 }, label: "Token 1:1" },
  board: { size: { width: 240, height: 240 }, label: "版图 1:1" },
};

const COLORS = ["#1a1a1a", "#e63946", "#457b9d", "#2e7d32", "#f2c200", "#ffffff"];
const BRUSH_SIZES = [1, 3, 6];
const SCALE = 2; // 像素分辨率 = 导出尺寸 × 2
const UNDO_LIMIT = 20;
const DISPLAY_H = 320; // 画布显示高度（CSS px），宽按比例
const SIZE_MIN = 16;
const SIZE_MAX = 480;

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

  /** 完成：导出透明 PNG（分辨率 = 尺寸 × 2） */
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
      drawingRef.current = true;
      const p = toCanvas(e);
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
      ctx.lineWidth = brush;
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
  }, [color, brush, eraser]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
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
            className="border-2 border-ink cursor-crosshair touch-none"
            style={{
              width: DISPLAY_H * (size.width / size.height),
              height: DISPLAY_H,
              background: "var(--surface)",
            }}
          />
        </div>

        {/* 工具行：颜色 / 粗细 / 橡皮 / 撤销 / 清空 */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`w-6 h-6 rounded-full border-2 cursor-pointer transition-transform ${
                  color === c && !eraser ? "border-ink scale-110" : "border-ink/30 hover:border-ink"
                }`}
                style={{ background: c }}
                onClick={() => {
                  setColor(c);
                  setEraser(false);
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {BRUSH_SIZES.map((b) => (
              <button
                key={b}
                className={`w-8 h-8 border-2 flex items-center justify-center cursor-pointer ${
                  brush === b && !eraser ? "border-ink bg-ink/10" : "border-ink/30 hover:border-ink"
                }`}
                onClick={() => {
                  setBrush(b);
                  setEraser(false);
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
            onClick={() => setEraser((v) => !v)}
          >
            橡皮
          </button>
          <button className="text-xs px-3 py-1.5 border-2 border-ink/40 hover:border-ink cursor-pointer" onClick={undo}>
            撤销
          </button>
          <button className="text-xs px-3 py-1.5 border-2 border-ink/40 hover:border-ink cursor-pointer" onClick={clear}>
            清空
          </button>
        </div>

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
