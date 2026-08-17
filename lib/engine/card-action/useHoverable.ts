"use client";

import { useState, useEffect, useCallback } from "react";
import { useCardActionContext } from "./CardActionProvider";

interface UseHoverableOptions {
  id: string;
}

interface UseHoverableReturn {
  isHovered: boolean;
  hoverProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
}

export function useHoverable({ id }: UseHoverableOptions): UseHoverableReturn {
  const { setActive, clearActive } = useCardActionContext();

  const [isHovered, setIsHovered] = useState(false);

  const onEnter = useCallback(() => {
    setIsHovered(true);
    setActive(id);
  }, [id, setActive]);

  const onLeave = useCallback(() => {
    setIsHovered(false);
    clearActive(id);
  }, [id, clearActive]);

  // 卸载时清理：如果该牌是当前 active，从 provider 注销
  useEffect(() => {
    return () => {
      clearActive(id);
    };
  }, [id, clearActive]);

  return {
    isHovered,
    hoverProps: {
      onMouseEnter: onEnter,
      onMouseLeave: onLeave,
    },
  };
}
