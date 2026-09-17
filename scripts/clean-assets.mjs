// ============================================================
// 资产清洗脚本：删除桌游数据中运行时不可达的 prefabs / sprites
// 判定（与运行时引用链一致）：
//   prefab 被使用 ⟺ initialState.entities[].prefabId 引用之
//   sprite 被使用 ⟺ 保留 prefab 的 faces.front / faces.back（非空）引用之
// 规则：
//   不重编号 id、保持数组原顺序；悬空引用只警告不删实体；重复运行幂等
// 用法：
//   node scripts/clean-assets.mjs          # dry-run，只报告不写盘
//   node scripts/clean-assets.mjs --write  # 先备份到 server/data/backup-<YYYYMMDD-HHmmss>/ 再原地写回
// ============================================================

import fs from "fs";
import path from "path";

const write = process.argv.includes("--write");
const gamesDir = path.join(import.meta.dirname, "..", "server", "data", "games");
const dataDir = path.dirname(gamesDir);

if (!fs.existsSync(gamesDir)) {
  console.log("无游戏数据目录，退出");
  process.exit(0);
}

const files = fs.readdirSync(gamesDir).filter((f) => f.endsWith(".json")).sort();
if (files.length === 0) {
  console.log("无桌游数据文件，退出");
  process.exit(0);
}

const mb = (n) => (n / 1024 / 1024).toFixed(2);

/** 惰性创建本次运行的备份目录（仅当有文件被修改时） */
let backupDir = null;
function ensureBackupDir() {
  if (backupDir) return backupDir;
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const base = path.join(dataDir, `backup-${ts}`);
  let dir = base;
  let i = 1;
  while (fs.existsSync(dir)) dir = `${base}-${i++}`;
  fs.mkdirSync(dir, { recursive: true });
  backupDir = dir;
  return dir;
}

let scanned = 0;
let changed = 0;
let totalSprites = 0;
let totalPrefabs = 0;
let totalBytes = 0;

for (const file of files) {
  const filePath = path.join(gamesDir, file);

  let game;
  try {
    game = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    console.warn(`skip ${file}: JSON 解析失败（${e.message}）`);
    continue;
  }

  const sprites = game?.assets?.sprites;
  const prefabs = game?.assets?.prefabs;
  const entities = game?.initialState?.entities;
  if (!Array.isArray(sprites) || !Array.isArray(prefabs) || !Array.isArray(entities)) {
    console.warn(`skip ${file}: 结构不符（缺 assets.sprites / assets.prefabs / initialState.entities）`);
    continue;
  }
  scanned++;

  // 1) prefab：被 initialState.entities 引用的保留
  const allPrefabIds = new Set(prefabs.map((p) => p.id));
  const usedPrefabIds = new Set(entities.map((e) => e.prefabId));
  const keptPrefabs = prefabs.filter((p) => usedPrefabIds.has(p.id));
  const removedPrefabs = prefabs.filter((p) => !usedPrefabIds.has(p.id));

  // 2) sprite：被保留 prefab 的 faces 引用（非空）的保留
  const spriteIds = new Set(sprites.map((s) => s.id));
  const neededSpriteIds = new Set();
  for (const p of keptPrefabs) {
    for (const v of [p.faces?.front, p.faces?.back]) if (v) neededSpriteIds.add(v);
  }
  const keptSprites = sprites.filter((s) => neededSpriteIds.has(s.id));
  const removedSprites = sprites.filter((s) => !neededSpriteIds.has(s.id));

  // 悬空引用：只警告，不删实体、不改引用
  const danglingSprites = [...neededSpriteIds].filter((id) => !spriteIds.has(id));
  const danglingPrefabs = [...usedPrefabIds].filter((id) => !allPrefabIds.has(id));
  if (danglingSprites.length > 0) {
    console.warn(`warn ${file}: ${danglingSprites.length} 个 faces 引用的 sprite 缺失（保留引用不动）: ${danglingSprites.slice(0, 3).join(", ")}`);
  }
  if (danglingPrefabs.length > 0) {
    console.warn(`warn ${file}: ${danglingPrefabs.length} 个实体引用的 prefab 缺失（实体保留不动）: ${danglingPrefabs.slice(0, 3).join(", ")}`);
  }

  if (removedPrefabs.length === 0 && removedSprites.length === 0) {
    console.log(`ok   ${file}: 无需清理（sprites ${sprites.length} / prefabs ${prefabs.length}）`);
    continue;
  }

  const beforeBytes = fs.statSync(filePath).size;
  const removedBytes =
    Buffer.byteLength(JSON.stringify(removedSprites)) + Buffer.byteLength(JSON.stringify(removedPrefabs));

  if (write) {
    const dir = ensureBackupDir();
    fs.copyFileSync(filePath, path.join(dir, file));
    game.assets.prefabs = keptPrefabs;
    game.assets.sprites = keptSprites;
    fs.writeFileSync(filePath, JSON.stringify(game, null, 2));
  }

  const afterBytes = write ? fs.statSync(filePath).size : beforeBytes - removedBytes;
  changed++;
  totalSprites += removedSprites.length;
  totalPrefabs += removedPrefabs.length;
  totalBytes += beforeBytes - afterBytes;

  console.log(
    `${write ? "clean" : "dry  "} ${file}: sprites ${sprites.length}→${keptSprites.length} (-${removedSprites.length}), ` +
      `prefabs ${prefabs.length}→${keptPrefabs.length} (-${removedPrefabs.length}), ` +
      `${mb(beforeBytes)}MB→${mb(afterBytes)}MB (-${mb(beforeBytes - afterBytes)}MB)`
  );
}

console.log(
  `\n${write ? "已清理" : "待清理"}：文件 ${changed}/${scanned}，sprites -${totalSprites}，prefabs -${totalPrefabs}，${write ? "释放" : "预计释放"} ${mb(totalBytes)}MB`
);
if (write) {
  console.log(backupDir ? `备份目录：${path.relative(process.cwd(), backupDir)}` : "无文件被修改，未创建备份");
} else {
  console.log("以上为 dry-run，未写盘；加 --write 执行清理");
}
