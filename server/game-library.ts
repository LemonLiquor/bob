import fs from "fs";
import path from "path";
import type { GameAssets, GameState } from "../lib/engine/types";
import type { GameInfo } from "../lib/multiplayer/protocol";

// ============================================================
// GameLibrary — 桌游库（持久化）
// 桌游 = 元数据（id/name/icon）+ 资产（sprites 图片表 + prefabs 模板表）
//      + 无座初始状态（initialState，坐标由导入页 Lab 自定义）
// 存 server/data/games/<gameId>.json，跨重启存活。
// ============================================================

const DATA_DIR = path.join(__dirname, "data", "games");

export interface SavedGame {
  meta: { id: string; name: string; icon: string };
  assets: GameAssets; // sprites（图片表）+ prefabs（模板表）
  initialState: GameState; // 无座（seats: []），创建房间/试玩直接使用
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

  /** 保存桌游（幂等覆盖）并落盘 */
  /**
   * 保存桌游。**不允许覆盖**：同 id 已存在 → 拒绝并返回 false（上传永远是新桌游）。
   * 文件直接写入（无备份；data 目录 gitignore，误覆盖只能靠文件系统恢复）
   */
  saveGame(game: SavedGame): boolean {
    if (this.games.has(game.meta.id)) {
      console.warn(`[lib] reject upload: game ${game.meta.id} already exists (overwrite forbidden)`);
      return false;
    }
    this.games.set(game.meta.id, game);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = path.join(DATA_DIR, `${game.meta.id}.json`);
    fs.writeFileSync(file, JSON.stringify(game, null, 2));
    console.log(`[lib] saved game: ${game.meta.id} (${game.meta.name}, ${game.assets.sprites.length} sprites / ${game.assets.prefabs.length} prefabs)`);
    return true;
  }

  getGame(gameId: string): SavedGame | null {
    return this.games.get(gameId) ?? null;
  }

  listGames(): GameInfo[] {
    return Array.from(this.games.values()).map((g) => ({
      id: g.meta.id,
      name: g.meta.name,
      icon: g.meta.icon,
    }));
  }
}
