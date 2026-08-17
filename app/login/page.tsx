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
    <main className="min-h-screen flex items-center justify-center bg-[#f0f0f0]">
      <div className="bg-white rounded-lg p-8 shadow-md w-[320px] text-center">
        <h1 className="text-2xl mb-6">♟️ BoardGame Lab</h1>
        <input
          className="border rounded px-3 py-2 text-lg w-full text-center focus:outline-none focus:border-blue-400"
          placeholder="输入昵称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleEnter()}
          autoFocus
        />
        <button
          className="w-full bg-blue-500 text-white rounded py-2 text-lg mt-3 cursor-pointer hover:bg-blue-600 disabled:opacity-40"
          disabled={!name.trim()}
          onClick={handleEnter}
        >
          进入
        </button>
      </div>
    </main>
  );
}
