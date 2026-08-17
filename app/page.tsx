"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const name = localStorage.getItem("bg_player_name");
    if (name) {
      router.replace("/games");
    } else {
      router.replace("/login");
    }
  }, [router]);

  return null;
}
