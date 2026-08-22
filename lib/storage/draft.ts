// ============================================================
// Draft — 桌游组装草稿（indexDB，单槽位 'active'）
// 保存 = 手动 [保存] 按钮（无自动保存）；进入 /lab 自动恢复；上传成功/丢弃时清除。
// 草稿与上传格式同构：meta + assets + 无座 initialState。
// ============================================================

import type { GameAssets, GameState } from "../engine/types";

export interface Draft {
  meta: { id: string; name: string; icon: string };
  assets: GameAssets; // sprites + prefabs（全量累积）
  initialState: GameState; // 无座（seats: []），坐标 = Lab 布局
  updatedAt: number;
}

const DB_NAME = "bob-draft";
const DB_VERSION = 1;
const STORE = "draft";
const KEY = "active";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 写入草稿（幂等覆盖） */
export async function saveDraft(draft: Omit<Draft, "updatedAt">): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...draft, updatedAt: Date.now() }, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 读取草稿；无草稿返回 null */
export async function loadDraft(): Promise<Draft | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as Draft | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** 清除草稿 */
export async function clearDraft(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
