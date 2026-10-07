import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import { buildTtsGame, type TtsBuildResult } from "./build";
import { parseTtsSave } from "./parse";
import { applyAction } from "../engine/reducers";
import { pruneUnusedAssets } from "../engine/prune-assets";

// ============================================================
// TTS 管线测试 — 真实存档端到端（本地 Mod 文件存在才跑，CI/他人机器自动 skip）
// 覆盖：卡背语义 / 空堆 / 双面 token / 占位标记 / 骰子可视化 / prune
// ============================================================

const REAL_SAVE = "E:/Downloads/桌游/Mods/Workshop/1621070501.json";
const REAL_IMG_DIR = "E:/Downloads/桌游/Mods/Images";
const hasRealData = fs.existsSync(REAL_SAVE) && fs.existsSync(REAL_IMG_DIR);

let result: TtsBuildResult;
let save: { SaveName?: string; ObjectStates: unknown[] };

beforeAll(async () => {
  if (!hasRealData) return;
  save = JSON.parse(fs.readFileSync(REAL_SAVE, "utf8"));
  const files = fs.readdirSync(REAL_IMG_DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  const images = new Map(
    files.map((f) => {
      const key = f.replace(/\.(png|jpe?g|webp)$/i, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      return [key, { dataUrl: "img:" + key, width: 1000, height: 1400 }];
    }),
  );
  const deps = {
    images,
    async cutAtlas(src: { dataUrl: string }, cols: number, rows: number) {
      const out: { col: number; row: number; dataUrl: string; width: number; height: number }[] = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          out.push({ col: c, row: r, dataUrl: `${src.dataUrl}#${r * cols + c}`, width: 100, height: 100 });
      return out;
    },
    makeMarker: (label: string) => ({ dataUrl: "marker:" + label, width: 256, height: 192 }),
  };
  result = await buildTtsGame(save as never, deps as never);
}, 30000);

describe.skipIf(!hasRealData)("buildTtsGame — 以撒真实存档", () => {
  const spriteById = (r: TtsBuildResult) => new Map(r.assets.sprites.map((s) => [s.id, s]));

  it("库存报告：S1 计数含占位标记", () => {
    const files = fs.readdirSync(REAL_IMG_DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
    const inv = parseTtsSave(save as never, files);
    expect(inv.importable.markers).toBe(34); // 21 Assetbundle + 13 backgammon
    expect(inv.importable.dice).toBe(14);
    expect(inv.importable.counters).toBe(5);
  });

  it("无空堆、无悬空引用（堆叠失效根因）", () => {
    const ids = new Set(result.initialState.entities.map((e) => e.id));
    expect(result.initialState.piles.filter((p) => p.entityIds.length === 0)).toHaveLength(0);
    for (const p of result.initialState.piles) {
      for (const id of p.entityIds) expect(ids.has(id)).toBe(true);
    }
  });

  it("卡背：UniqueBack=false → 全部有图、整背 0 号格、同图集共用同背", () => {
    const sprites = spriteById(result);
    const cardPrefabs = result.assets.prefabs.filter((p) => p.kind === "card");
    expect(cardPrefabs.length).toBeGreaterThan(700);
    const backByFrontKey = new Map<string, string>();
    for (const p of cardPrefabs) {
      if (p.kind !== "card") continue;
      expect(p.faces.back).not.toBe(""); // 不允许缺背
      const backUrl = sprites.get(p.faces.back)?.url ?? "";
      expect(backUrl.endsWith("#0")).toBe(true); // 整副共用单张完整背
      const frontKey = (sprites.get(p.faces.front)?.url ?? "").split("#")[0];
      const prev = backByFrontKey.get(frontKey);
      if (prev) expect(backUrl).toBe(prev);
      backByFrontKey.set(frontKey, backUrl);
    }
  });

  it("说明书：双面 token 且只发一张，flip_token 生效", () => {
    const sprites = spriteById(result);
    const bookFront = [...sprites.values()].find((s) => s.url.includes("77771b66d"));
    expect(bookFront).toBeDefined();
    const bookPrefab = result.assets.prefabs.find(
      (p) => p.kind === "token" && p.faces.front === bookFront!.id,
    );
    expect(bookPrefab).toBeDefined();
    expect(bookPrefab!.kind === "token" && bookPrefab.faces.back).toBeTruthy();
    const entities = result.initialState.entities.filter((e) => e.prefabId === bookPrefab!.id);
    expect(entities).toHaveLength(1);
    const flipped = applyAction(result.initialState, { type: "flip_token", entityId: entities[0].id });
    expect(flipped.entities.find((e) => e.id === entities[0].id)?.faceUp).toBe(false);
  });

  it("占位标记 37 个（21 Assetbundle + 13 棋子 + 3 无图模型）", () => {
    const sprites = spriteById(result);
    const prefabById = new Map(result.assets.prefabs.map((p) => [p.id, p]));
    const markers = result.initialState.entities.filter((e) => {
      const p = prefabById.get(e.prefabId);
      if (!p || p.kind === "die") return false;
      const front = p.kind === "die" ? "" : sprites.get(p.faces.front)?.url ?? "";
      return front.startsWith("marker:");
    });
    expect(markers).toHaveLength(37);
  });

  it("骰子：分布 / 自定义骰 6 面齐全 / HP 与体力角标着色", () => {
    const diePrefabs = result.assets.prefabs.filter((p) => p.kind === "die");
    const hist: Record<number, number> = {};
    for (const p of diePrefabs) if (p.kind === "die") hist[p.sides] = (hist[p.sides] ?? 0) + 1;
    expect(hist[6]).toBe(73);
    expect(hist[8]).toBe(1);
    expect(hist[20]).toBe(5);
    const withFaces = diePrefabs.filter((p) => p.kind === "die" && p.faces?.length === 6 && new Set(p.faces).size === 6);
    expect(withFaces).toHaveLength(36);
    expect(withFaces.every((p) => p.kind === "die" && p.faces!.every(Boolean))).toBe(true);
    const hp = diePrefabs.find((p) => p.kind === "die" && p.label === "HP");
    expect(hp?.kind === "die" && hp.tint).toBe("#260f0f");
    const stamina = diePrefabs.filter((p) => p.kind === "die" && p.label === "体力");
    expect(stamina).toHaveLength(5);
    expect(stamina.every((p) => p.kind === "die" && p.tint === "#151515")).toBe(true);
  });

  it("无同 prefab 同坐标双发", () => {
    const seen = new Set<string>();
    for (const e of result.initialState.entities) {
      const k = `${e.prefabId}@${e.x},${e.y},${e.zIndex}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it("prune 保留 die 骰面 sprite", () => {
    const pruned = pruneUnusedAssets(result.assets, result.initialState.entities);
    const dieFaceIds = new Set(
      result.assets.prefabs.flatMap((p) => (p.kind === "die" ? p.faces ?? [] : [])),
    );
    const kept = new Set(pruned.sprites.map((s) => s.id));
    for (const id of dieFaceIds) expect(kept.has(id)).toBe(true);
  });
});
