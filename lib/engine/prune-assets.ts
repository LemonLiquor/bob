import type { EntityState, GameAssets } from "./types";

// ============================================================
// 资产清洗 — 删除运行时不可达的 prefabs / sprites
// 调用点：创建桌游最后一步（server/game-library.ts saveGame，写入/入内存前）
// 判定与运行时引用链一致：
//   prefab 被使用 ⟺ initialState.entities[].prefabId 引用之
//   sprite 被使用 ⟺ 保留 prefab 的 faces 引用之（逐值扫描，兼容 card/token/board）
// 不重编号 id、保持数组原顺序、不修改入参
// ============================================================

export function pruneUnusedAssets(assets: GameAssets, entities: EntityState[]): GameAssets {
  const usedPrefabIds = new Set(entities.map((e) => e.prefabId));
  const prefabs = assets.prefabs.filter((p) => usedPrefabIds.has(p.id));

  const usedSpriteIds = new Set<string>();
  for (const p of prefabs) {
    if (p.kind === "die") continue; // die 无图：不引用 sprite
    for (const v of Object.values(p.faces)) {
      if (v) usedSpriteIds.add(v);
    }
  }
  const sprites = assets.sprites.filter((s) => usedSpriteIds.has(s.id));

  return { sprites, prefabs };
}
