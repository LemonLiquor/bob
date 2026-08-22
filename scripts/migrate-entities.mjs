// ============================================================
// 实体类型迁移脚本：旧 json（无 kind）→ 新结构（kind 判别联合）
// 规则：
//   prefab：singleFace === true → token（faces 只留 front）；否则 → card（faces 保留 front/back）
//   entity：按 prefab kind 补 kind；补 rotation: 0；删 singleFace 字段
// 用法：node scripts/migrate-entities.mjs（原地写回 server/data/games/*.json，已迁移的跳过）
// ============================================================

import fs from "fs";
import path from "path";

const dir = path.join(import.meta.dirname, "..", "server", "data", "games");
if (!fs.existsSync(dir)) {
  console.log("无游戏数据目录，跳过");
  process.exit(0);
}

let migrated = 0;
let skipped = 0;

for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith(".json")) continue;
  const filePath = path.join(dir, file);
  const game = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  const prefabs = game?.assets?.prefabs;
  const entities = game?.initialState?.entities;
  if (!Array.isArray(prefabs) || !Array.isArray(entities)) {
    console.log(`skip ${file}: 结构不符`);
    skipped++;
    continue;
  }

  const prefabKind = new Map();
  let changed = false;

  for (const p of prefabs) {
    if (p.kind) continue; // 已迁移
    const kind = p.singleFace ? "token" : "card";
    p.kind = kind;
    delete p.singleFace;
    if (kind === "token") {
      p.faces = { front: p.faces.front }; // token 单面
    } else {
      p.faces = { front: p.faces.front, back: p.faces.back ?? "" };
    }
    prefabKind.set(p.id, kind);
    changed = true;
  }

  for (const e of entities) {
    if (e.kind) continue;
    e.kind = prefabKind.get(e.prefabId) ?? "card"; // 引用缺失默认 card
    e.rotation = 0;
    delete e.singleFace;
    changed = true;
  }

  if (!changed) {
    console.log(`skip ${file}: 已是新结构`);
    skipped++;
    continue;
  }

  fs.writeFileSync(filePath, JSON.stringify(game, null, 2));
  const kinds = prefabs.reduce((acc, p) => ((acc[p.kind] = (acc[p.kind] ?? 0) + 1), acc), {});
  console.log(`migrated ${file}: prefabs=${JSON.stringify(kinds)}, entities=${entities.length}`);
  migrated++;
}

console.log(`完成：迁移 ${migrated}，跳过 ${skipped}`);
