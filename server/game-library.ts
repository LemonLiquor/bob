import fs from "fs";
import path from "path";
import type { GameAssets, GameState, GamePreset } from "../lib/engine/types";
import { pruneUnusedAssets } from "../lib/engine/prune-assets";
import type { GameInfo } from "../lib/multiplayer/protocol";

// ============================================================
// GameLibrary — 桌游库（持久化）
// 桌游 = 元数据（id/name/icon）+ 资产（sprites 图片表 + prefabs 模板表）
//      + 无座初始状态（initialState，坐标由导入页 Lab 自定义）
//      + 预设（presets，对局中保存的桌面快照，可选）
// 存 server/data/games/<gameId>.json，跨重启存活。
// ============================================================

const DATA_DIR = path.join(__dirname, "data", "games");

export interface SavedGame {
  meta: { id: string; name: string; icon: string };
  assets: GameAssets; // sprites（图片表）+ prefabs（模板表）
  initialState: GameState; // 无座（seats: []），创建房间/试玩直接使用
  presets?: GamePreset[]; // 对局中保存的桌面快照（旧存档无此字段 = 空列表）
  createdAt: number;
  updatedAt: number;
}

export class GameLibrary {
  private games: Map<string, SavedGame> = new Map();

  /** 启动时扫描目录加载 */
  loadAll(): void {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    for (const file of fs.readdirSync(DATA_DIR)) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = fs.readFileSync(path.join(DATA_DIR, file), "utf-8");
        const game = JSON.parse(raw) as SavedGame;
        // 格式校验：新格式必须含 assets.sprites 与 initialState，缺失则跳过
        if (!game.assets || !Array.isArray(game.assets.sprites) || !game.initialState) {
          console.warn(`[lib] skip ${file}: 格式校验失败`);
          continue;
        }
        this.games.set(game.meta.id, game);
        console.log(`[lib] loaded game: ${game.meta.id} (${game.meta.name}, ${game.assets.sprites.length} sprites / ${game.assets.prefabs.length} prefabs)`);
      } catch (e) {
        console.error(`[lib] failed to load ${file}:`, e);
      }
    }
  }

  /**
   * 保存桌游。**不允许覆盖**：同 id 已存在 → 拒绝并返回 false（上传永远是新桌游）。
   * 创建桌游最后一步：写入/入内存前清洗运行时不可达资产（pruneUnusedAssets）。
   * 文件直接写入（无备份；data 目录 gitignore，误覆盖只能靠文件系统恢复）
   */
  saveGame(game: SavedGame): boolean {
    if (this.games.has(game.meta.id)) {
      console.warn(`[lib] reject upload: game ${game.meta.id} already exists (overwrite forbidden)`);
      return false;
    }
    const assets = pruneUnusedAssets(game.assets, game.initialState.entities);
    const saved: SavedGame = { ...game, assets };
    this.games.set(saved.meta.id, saved);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = path.join(DATA_DIR, `${saved.meta.id}.json`);
    fs.writeFileSync(file, JSON.stringify(saved, null, 2));
    const removedSprites = game.assets.sprites.length - assets.sprites.length;
    const removedPrefabs = game.assets.prefabs.length - assets.prefabs.length;
    const pruned = removedSprites || removedPrefabs ? `, pruned ${removedSprites} sprites / ${removedPrefabs} prefabs` : "";
    console.log(`[lib] saved game: ${saved.meta.id} (${saved.meta.name}, ${assets.sprites.length} sprites / ${assets.prefabs.length} prefabs${pruned})`);
    return true;
  }

  getGame(gameId: string): SavedGame | null {
    return this.games.get(gameId) ?? null;
  }

  /**
   * 追加预设到桌游（就地更新 json 文件；与 saveGame 的"禁止覆盖"无关——
   * 预设只增不改，重名允许共存，由 UI 展示区分）。
   * 桌游不存在 → false；预设内容不清洗（实体引用的资产必然已入库）
   */
  savePreset(gameId: string, preset: GamePreset): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;
    game.presets = [...(game.presets ?? []), preset];
    game.updatedAt = Date.now();
    const file = path.join(DATA_DIR, `${gameId}.json`);
    fs.writeFileSync(file, JSON.stringify(game, null, 2));
    console.log(`[lib] preset saved: ${preset.name} → ${gameId} (${game.presets.length} presets)`);
    return true;
  }

  listPresets(gameId: string): GamePreset[] {
    return this.games.get(gameId)?.presets ?? [];
  }

  /** 删除预设（就地更新 json 文件）。桌游或预设不存在 → false */
  deletePreset(gameId: string, presetId: string): boolean {
    const game = this.games.get(gameId);
    if (!game || !game.presets?.some((p) => p.id === presetId)) return false;
    game.presets = game.presets.filter((p) => p.id !== presetId);
    game.updatedAt = Date.now();
    const file = path.join(DATA_DIR, `${gameId}.json`);
    fs.writeFileSync(file, JSON.stringify(game, null, 2));
    console.log(`[lib] preset deleted: ${presetId} → ${gameId} (${game.presets.length} presets)`);
    return true;
  }

  listGames(): GameInfo[] {
    return Array.from(this.games.values()).map((g) => ({
      id: g.meta.id,
      name: g.meta.name,
      icon: g.meta.icon,
    }));
  }
}
