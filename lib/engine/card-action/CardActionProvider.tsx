"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";

interface CardActionContextType {
  setActive: (id: string) => void;
  clearActive: (id: string) => void;
}

const CardActionContext = createContext<CardActionContextType | null>(null);

export function useCardActionContext() {
  const ctx = useContext(CardActionContext);
  if (!ctx) {
    throw new Error("useCardActionContext must be used within <CardActionProvider>");
  }
  return ctx;
}

/** 鼠标位置下的卡牌 id（按 data-card-id 向上查找） */
function cardIdAtPointer(pointer: { x: number; y: number }): string | null {
  const el = document.elementFromPoint(pointer.x, pointer.y);
  const cardEl = el?.closest?.("[data-card-id]");
  return cardEl ? cardEl.getAttribute("data-card-id") : null;
}

interface CardActionProviderProps {
  children: ReactNode;
  onFlip: (cardId: string) => void;
  onDraw: (id: string) => void;      // id 为悬停牌 id：抓入手牌区（自由牌 / 牌堆顶牌均可）
  onRotate?: (id: string) => void;   // R 键旋转悬停实体（仅 board 生效，GameBoard 按 kind 拦截）
  onDelete?: (id: string) => void;   // Lab 编辑：Delete 键删除悬停实体（可选，不进协议）
  onCopy?: (id: string) => void;     // Lab 编辑：Ctrl/Cmd+D 复制悬停实体（可选，不进协议）
  disabled?: boolean;
}

export default function CardActionProvider({
  children,
  onFlip,
  onDraw,
  onRotate,
  onDelete,
  onCopy,
  disabled = false,
}: CardActionProviderProps) {
  const activeIdRef = useRef<string | null>(null);

  const onFlipRef = useRef(onFlip);
  const onDrawRef = useRef(onDraw);
  const onRotateRef = useRef(onRotate);
  const onDeleteRef = useRef(onDelete);
  const onCopyRef = useRef(onCopy);
  const disabledRef = useRef(disabled);

  useEffect(() => {
    onFlipRef.current = onFlip;
    onDrawRef.current = onDraw;
    onRotateRef.current = onRotate;
    onDeleteRef.current = onDelete;
    onCopyRef.current = onCopy;
    disabledRef.current = disabled;
  });

  const setActive = useCallback((id: string) => {
    activeIdRef.current = id;
  }, []);

  const clearActive = useCallback((id: string) => {
    if (activeIdRef.current === id) {
      activeIdRef.current = null;
    }
  }, []);

  // 记录最近一次鼠标位置（keydown 没有坐标，用于 elementFromPoint 兜底）
  const pointerRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabledRef.current) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      // active 缺失时从鼠标位置兜底：元素可能在鼠标下方才被渲染（如刚进房间），
      // mouseenter 不会触发，但 elementFromPoint 能直接命中
      const id = activeIdRef.current ?? cardIdAtPointer(pointerRef.current);
      if (!id) return;

      const lower = e.key.toLowerCase();
      // 复制（Ctrl/Cmd+D）：preventDefault 阻止浏览器书签快捷键；优先级高于抓牌（D）
      if ((e.ctrlKey || e.metaKey) && lower === "d") {
        e.preventDefault();
        onCopyRef.current?.(id);
        return;
      }
      if (lower === "f" && !e.shiftKey) onFlipRef.current(id); // Shift+F = 翻整叠（Pile 监听），此处排除避免顶牌双翻
      if (lower === "d") onDrawRef.current(id);
      if (lower === "r") onRotateRef.current?.(id);
      if (e.key === "Delete") onDeleteRef.current?.(id);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <CardActionContext.Provider value={{ setActive, clearActive }}>
      {children}
    </CardActionContext.Provider>
  );
}
