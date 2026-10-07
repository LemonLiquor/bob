"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================
// useViewport — 桌面缩放/平移（会话 UI 状态，不入存档）
// 渲染容器 translate(pan) scale(zoom)，origin 0 0：
// - 滚轮缩放：以鼠标为中心，保持鼠标下的桌面点不动
// - 空白处拖拽平移（卡片/牌堆上不触发）
// mainRef 挂在监听宿主元素上；toDesk 把视口坐标换算为桌面坐标（引擎 state 语义）
// ============================================================

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export function useViewport() {
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const mainRef = useRef<HTMLElement>(null);
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  // 视口 → 桌面坐标（引擎 state 语义）
  const toDesk = useCallback((vx: number, vy: number) => {
    const v = viewRef.current;
    return { x: (vx - v.x) / v.zoom, y: (vy - v.y) / v.zoom };
  }, []);

  // 滚轮缩放（鼠标为中心，保持鼠标下的桌面点不动）+ 拖拽空白平移
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const nz = Math.min(4, Math.max(0.2, v.zoom * factor));
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const dx = (mx - v.x) / v.zoom; // 鼠标下的桌面点（缩放前）
      const dy = (my - v.y) / v.zoom;
      setView({ x: mx - dx * nz, y: my - dy * nz, zoom: nz });
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-card-id]") || t.closest('[id^="pile-"]')) return; // 卡片/牌堆上不平移
      panRef.current = { sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y };
    };
    const onPointerMove = (e: PointerEvent) => {
      const p = panRef.current;
      if (!p) return;
      setView((v) => ({ ...v, x: p.ox + (e.clientX - p.sx), y: p.oy + (e.clientY - p.sy) }));
    };
    const onPointerUp = () => {
      panRef.current = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  return { view, mainRef, toDesk };
}
