"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("bg_player_name");
    if (saved) {
      router.replace("/games");
      return;
    }
    setChecking(false);
  }, [router]);

  function handleEnter() {
    const trimmed = name.trim();
    if (!trimmed) return;

    localStorage.setItem("bg_player_name", trimmed);

    if (!localStorage.getItem("bg_player_id")) {
      localStorage.setItem("bg_player_id", crypto.randomUUID());
    }

    router.replace("/games");
  }

  if (checking) return null;

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
