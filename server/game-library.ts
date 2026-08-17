import fs from "fs";
import path from "path";
import type { CardAsset } from "../lib/engine/types";
import type { GameInfo } from "../lib/multiplayer/protocol";

// ============================================================
// GameLibrary — 桌游库（持久化）
// 桌游 = 元数据（id/name/icon）+ 卡牌资产（一张卡 = 一个对象，正反图 dataURL）
// 存 server/data/games/<gameId>.json，跨重启存活。
// 初始状态不下发/不落盘：客户端收到资产后自行 buildGame（含居中），
// 多人房间由创建者初始化后 update_game_state 广播。
// ============================================================

const DATA_DIR = path.join(__dirname, "data", "games");

export interface SavedGame {
  meta: { id: string; name: string; icon: string };
  assets: CardAsset[]; // 一张卡 = 一个对象（id + frontUrl + backUrl?）
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
        // 格式校验：新格式 assets 必须是数组（旧格式 Record<id, dataURL> 不兼容，跳过）
        if (!Array.isArray(game.assets)) {
          console.warn(`[lib] skip ${file}: 旧格式资产（非数组），请重新导入`);
          continue;
        }
        this.games.set(game.meta.id, game);
        console.log(`[lib] loaded game: ${game.meta.id} (${game.meta.name}, ${Object.keys(game.assets).length} assets)`);
      } catch (e) {
        console.error(`[lib] failed to load ${file}:`, e);
      }
    }
  }

  /** 保存桌游（幂等覆盖）并落盘 */
  saveGame(game: SavedGame): void {
    this.games.set(game.meta.id, game);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = path.join(DATA_DIR, `${game.meta.id}.json`);
    fs.writeFileSync(file, JSON.stringify(game, null, 2));
    console.log(`[lib] saved game: ${game.meta.id} (${game.meta.name}, ${Object.keys(game.assets).length} assets)`);
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
