"use client";

import { useCallback, useMemo, useState } from "react";
import type { GameState } from "@/lib/engine";
import { getPrefabFaces, getPrefabSize } from "@/lib/assets/cache";

// ============================================================
// useEntityPreview — 实体快捷键预览（会话 UI 状态，不入存档）
// 按住 Z = 鼠标右上角浮动预览（实体×2 等比，clamp 90% 视口；松开/失焦关闭，
// keyup/blur 由 CardActionProvider 分发）；V = 居中查看（切换式：再按 V 或点遮罩关闭）。
// die 无图不响应。
// 处理器用普通函数：直接调 setState 的回调用 useCallback 手动记忆化会
// 触发 react-hooks/preserve-manual-memoization（GameBoard 同惯例）
// ============================================================

export interface ZoomPreviewRect {
  src: string;
  left: number;
  top: number;
  w: number;
  h: number;
}

export function useEntityPreview(gameState: GameState) {
  const [zoomPreview, setZoomPreview] = useState<ZoomPreviewRect | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);

  const currentFaceSrc = useCallback((id: string): string | undefined => {
    const e = gameState.entities.find((x) => x.id === id);
    const faces = e ? getPrefabFaces(e.prefabId) : undefined;
    if (!e || !faces) return undefined;
    return (e.kind === "card" || e.kind === "token") && !e.faceUp ? faces[1] || faces[0] : faces[0];
  }, [gameState]);

  const viewSrc = useMemo(() => (viewId ? currentFaceSrc(viewId) : undefined), [viewId, currentFaceSrc]);

  function handleZoomStart(id: string, pointer: { x: number; y: number }) {
    const e = gameState.entities.find((x) => x.id === id);
    if (!e || e.kind === "die") return;
    const src = currentFaceSrc(id);
    if (!src) return;
    // 显示尺寸 = 实体尺寸 ×2（等比），clamp 到 90% 视口内（大版图不超屏）
    const size = getPrefabSize(e.prefabId) ?? { width: 120, height: 168 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(1, (vw * 0.9) / (size.width * 2), (vh * 0.9) / (size.height * 2));
    const w = Math.round(size.width * 2 * scale);
    const h = Math.round(size.height * 2 * scale);
    // 位置 = 鼠标右上角一点（右 12 / 上 12）：右缘放不下翻左侧，仍放不下贴右缘；纵向 clamp 视口内
    let left = pointer.x + 12;
    if (left + w > vw - 8) left = pointer.x - w - 12;
    if (left + w > vw - 8) left = vw - 8 - w;
    left = Math.max(8, left);
    const top = Math.max(8, Math.min(pointer.y - h - 12, vh - 8 - h));
    setZoomPreview({ src, left, top, w, h });
  }

  function handleZoomEnd() {
    setZoomPreview(null);
  }

  function handleView(id: string) {
    const e = gameState.entities.find((x) => x.id === id);
    if (!e || e.kind === "die") return;
    setViewId(viewId && viewId === id ? null : id); // 切换式：再按 V 关闭，点击遮罩也关闭
  }

  function closeView() {
    setViewId(null);
  }

  return { zoomPreview, viewSrc, handleZoomStart, handleZoomEnd, handleView, closeView };
}
