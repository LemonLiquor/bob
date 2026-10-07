"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

// localStorage 是客户端外部源：useSyncExternalStore 读快照（SSR 占位 null），
// 避免 mount effect 里同步 setState（react-hooks/set-state-in-effect）
const noopSubscribe = () => () => {};
const getSavedName = () => localStorage.getItem("bg_player_name");
const getSavedNameServer = () => null;

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const savedName = useSyncExternalStore(noopSubscribe, getSavedName, getSavedNameServer);

  // 已有昵称 → 直接进广场（导航必须在 effect，渲染期不可跳转）
  useEffect(() => {
    if (savedName) router.replace("/games");
  }, [savedName, router]);

  function handleEnter() {
    const trimmed = name.trim();
    if (!trimmed) return;

    localStorage.setItem("bg_player_name", trimmed);

    if (!localStorage.getItem("bg_player_id")) {
      localStorage.setItem("bg_player_id", crypto.randomUUID());
    }

    router.replace("/games");
  }

  if (savedName) return null; // 已登录跳转中

  return (
    <main className="min-h-screen flex items-center justify-center bg-desk">
      <div className="panel-pop p-8 w-[320px] text-center">
        <h1 className="text-2xl font-bold tracking-tight mb-6">Box of Boardgames</h1>
        <input
          className="input-pop w-full text-center text-lg"
          placeholder="输入昵称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleEnter()}
          autoFocus
        />
        <button
          className="btn-pop w-full text-lg mt-4"
          disabled={!name.trim()}
          onClick={handleEnter}
        >
          进入
        </button>
      </div>
    </main>
  );
}
