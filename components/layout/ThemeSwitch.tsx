"use client";

import { useState } from "react";

const THEME_KEY = "bg_theme";

/** 明/暗主题切换（Bauhaus 模板风格），选择存 localStorage */
export default function ThemeSwitch() {
  const [dark, setDark] = useState(false);

  // 挂载前从 localStorage 恢复：render 期间调整 state（React 官方模式，
  // 避免 effect 内同步 setState；条件确保幂等）
  if (
    typeof window !== "undefined" &&
    !dark &&
    localStorage.getItem(THEME_KEY) === "dark"
  ) {
    setDark(true);
  }

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "";
    localStorage.setItem(THEME_KEY, next ? "dark" : "light");
  }

  return (
    <button
      onClick={toggle}
      className="w-10 h-10 border-2 border-ink bg-accent cursor-pointer flex items-center justify-center text-base transition-all duration-300 hover:rotate-[15deg] hover:scale-110 shadow-sm"
      title="切换明暗主题"
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}
