import { describe, it, expect } from "vitest";
import { moveCard, addScore, flipCard, flipPile, flipToken, setDie } from "./actions";
import { pruneUnusedAssets } from "./prune-assets";
import type { EntityState, GameState, Prefab, Sprite } from "./types";

// ============================================================
// 引擎层测试 — 小 fixture 直测纯函数（无 UI / 无 IO）
// 覆盖历史踩坑区：堆叠判定、翻面 kind 拦截、骰子 clamp、计分负 delta、资产清洗
// ============================================================

function entity(id: string, x: number, y: number, opts: Partial<EntityState> = {}): EntityState {
  return {
    id,
    prefabId: `p-${id}`,
    kind: "card",
    faceUp: false,
    rotation: 0,
    x,
    y,
    zIndex: 1,
    size: { width: 120, height: 168 },
    ...opts,
  };
}

function emptyState(entities: EntityState[]): GameState {
  return { entities, piles: [], seats: [] };
}

describe("addScore", () => {
  const base: GameState = {
    entities: [],
    piles: [],
    seats: [{ id: "s1", index: 1, label: "座位1", score: 5, handZone: { entityIds: [] } }],
  };

  it("正负 delta 都生效", () => {
    expect(addScore(base, "s1", 5).seats[0].score).toBe(10);
    expect(addScore(base, "s1", -3).seats[0].score).toBe(2);
  });

  it("座位不存在 → 原状态", () => {
    expect(addScore(base, "nope", 1)).toBe(base);
  });
});

describe("moveCard 堆叠", () => {
  it("自由牌叠到自由牌上 → 自动建堆", () => {
    const a = entity("a", 100, 100);
    const b = entity("b", 115, 115); // 中心距 ~21 < 阈值 30
    const after = moveCard(emptyState([a, b]), "b", a.x, a.y);
    expect(after.piles).toHaveLength(1);
    expect(after.piles[0].entityIds.sort()).toEqual(["a", "b"]);
  });

  it("多卡层叠不成堆时建堆 → 宿主不命中同簇散牌（堆落落点不漂移）", () => {
    // 三张散牌层叠在 (400,300) 附近（如手牌退桌场景），互相独立不成堆
    const a = entity("a", 395, 295, { zIndex: 1 });
    const b = entity("b", 400, 300, { zIndex: 2 });
    const c = entity("c", 405, 305, { zIndex: 3 });
    const x = entity("x", 0, 0, { zIndex: 4 });
    const after = moveCard(emptyState([a, b, c, x]), "x", 400, 300);
    expect(after.piles).toHaveLength(1);
    const pile = after.piles[0];
    expect(pile.entityIds.sort()).toEqual(["a", "x"]);
    // b/c 与落点中心距 < 阈值，属同簇散牌：不做宿主（否则其被拖走/入堆会带着整堆漂移）
    expect(pile.parentId).toBeUndefined();
    expect(pile.x).toBe(400);
    expect(pile.y).toBe(300);
  });

  it("层叠散牌躺在版图上时建堆 → 堆仍挂版图（相对坐标正确）", () => {
    const board = entity("bd", 1000, 1000, { kind: "board", size: { width: 800, height: 600 } });
    const a = entity("a", 95, 95, { parentId: "bd", zIndex: 1 });
    const b = entity("b", 100, 100, { parentId: "bd", zIndex: 2 });
    const x = entity("x", 0, 0, { zIndex: 4 });
    const after = moveCard(emptyState([board, a, b, x]), "x", 1100, 1100);
    expect(after.piles).toHaveLength(1);
    const pile = after.piles[0];
    expect(pile.parentId).toBe("bd");
    expect(pile.x).toBe(100); // 落点 1100 - 版图世界坐标 1000
    expect(pile.y).toBe(100);
  });

  it("自由牌拖到牌堆位置 → 入堆顶部", () => {
    const a = entity("a", 100, 100);
    const b = entity("b", 100, 100);
    const c = entity("c", 500, 500);
    const withPile: GameState = {
      ...emptyState([a, b, c]),
      piles: [{ id: "pile-0", entityIds: ["a", "b"], x: 100, y: 100 }],
    };
    const after = moveCard(withPile, "c", 100, 100);
    expect(after.piles.find((p) => p.entityIds.includes("c"))?.entityIds).toEqual(["a", "b", "c"]);
    expect(after.piles).toHaveLength(1); // 未新建堆
  });

  it("尺寸不同 → 不建堆，自由放置", () => {
    const a = entity("a", 100, 100);
    const big = entity("big", 500, 500, { size: { width: 394, height: 394 } });
    const after = moveCard(emptyState([a, big]), "big", a.x, a.y);
    expect(after.piles).toHaveLength(0);
    expect(after.entities.find((e) => e.id === "big")?.x).toBe(a.x);
  });

  it("异尺寸牌拖到牌堆上 → 不入堆，落在鼠标位置（不吸附堆）", () => {
    const a = entity("a", 100, 100);
    const b = entity("b", 100, 100);
    const big = entity("big", 500, 500, { size: { width: 394, height: 394 } });
    const s: GameState = {
      ...emptyState([a, b, big]),
      piles: [{ id: "pile-0", entityIds: ["a", "b"], x: 100, y: 100 }],
    };
    const after = moveCard(s, "big", 100, 100);
    expect(after.piles).toHaveLength(1); // 未入堆
    expect(after.entities.find((e) => e.id === "big")?.x).toBe(100); // 落点 = 鼠标位置
  });

  it("版图拖到牌堆上 → 不入堆、自由放置", () => {
    const a = entity("a", 100, 100);
    const b = entity("b", 100, 100);
    const board = entity("bd", 500, 500, { kind: "board", size: { width: 800, height: 600 } });
    const s: GameState = {
      ...emptyState([a, b, board]),
      piles: [{ id: "pile-0", entityIds: ["a", "b"], x: 100, y: 100 }],
    };
    const after = moveCard(s, "bd", 100, 100);
    expect(after.piles).toHaveLength(1);
    expect(after.entities.find((e) => e.id === "bd")?.parentId).toBeUndefined();
  });

  it("目标牌躺在版图上时建堆 → pile 挂版图，不挂堆成员牌（坐标不漂移）", () => {
    // 版图 B 世界位置 (500,400)；牌 X 在版图上（parentId=B，相对坐标 50,40 → 世界 550,440）
    const board = entity("B", 500, 400, { kind: "board", size: { width: 800, height: 600 } });
    const x = entity("X", 50, 40, { parentId: "B", zIndex: 2 });
    const c = entity("c", 900, 900);
    const after = moveCard(emptyState([board, x, c]), "c", 550, 440); // 拖到牌 X 上
    const pile = after.piles.find((p) => p.entityIds.includes("c"));
    expect(pile).toBeDefined();
    expect(pile!.parentId).toBe("B"); // 挂版图，而不是堆成员牌 X
    expect(pile!.x).toBe(50); // 相对版图 = 鼠标世界位置 550 - 版图 500
  });

  it("堆顶牌拖到同尺寸牌堆 → 入堆；源堆剩牌不解散", () => {
    const a = entity("a", 100, 100);
    const b = entity("b", 100, 100);
    const c = entity("c", 1000, 1000);
    const d = entity("d", 1000, 1000);
    const s: GameState = {
      ...emptyState([a, b, c, d]),
      piles: [
        { id: "pile-0", entityIds: ["a", "b"], x: 100, y: 100 },
        { id: "pile-1", entityIds: ["c", "d"], x: 1000, y: 1000 },
      ],
    };
    const after = moveCard(s, "c", 100, 100); // pile-1 顶牌 c 单独拖到 pile-0
    expect(after.piles.find((p) => p.id === "pile-0")?.entityIds).toEqual(["a", "b", "c"]);
    expect(after.piles.find((p) => p.id === "pile-1")?.entityIds).toEqual(["d"]); // pile 永不解散
  });
});

describe("翻面 kind 拦截", () => {
  const token = entity("t", 0, 0, { kind: "token", faceUp: true });
  const card = entity("c", 100, 100);

  it("flipCard 对 token 忽略（原状态原样返回）", () => {
    const s = emptyState([token, card]);
    expect(flipCard(s, "t")).toBe(s);
  });

  it("flipToken 翻双面 token，flipCard 仍只翻 card", () => {
    const after = flipToken(emptyState([token, card]), "t");
    expect(after.entities.find((e) => e.id === "t")?.faceUp).toBe(false);
    expect(flipCard(after, "t")).toBe(after); // flipCard 不碰 token
    const afterCard = flipCard(after, "c");
    expect(afterCard.entities.find((e) => e.id === "c")?.faceUp).toBe(true);
  });

  it("flipPile 只翻堆内 card，token 不动", () => {
    const tok = entity("t", 0, 0, { kind: "token", faceUp: true });
    const c1 = entity("c1", 100, 100);
    const s: GameState = {
      ...emptyState([tok, c1]),
      piles: [{ id: "pile-0", entityIds: ["t", "c1"], x: 100, y: 100 }],
    };
    const after = flipPile(s, "pile-0");
    expect(after.entities.find((e) => e.id === "t")?.faceUp).toBe(true);
    expect(after.entities.find((e) => e.id === "c1")?.faceUp).toBe(true); // 初始 false → 翻为 true
  });
});

describe("setDie", () => {
  it("clamp 到 1..sides", () => {
    const die = entity("d", 0, 0, { kind: "die", value: 3, sides: 6 });
    const s = emptyState([die]);
    expect(setDie(s, "d", 99).entities[0].value).toBe(6);
    expect(setDie(s, "d", 0).entities[0].value).toBe(1);
    expect(setDie(s, "d", 4).entities[0].value).toBe(4);
  });

  it("非 die 忽略", () => {
    const s = emptyState([entity("c", 0, 0)]);
    expect(setDie(s, "c", 2)).toBe(s);
  });
});

describe("pruneUnusedAssets", () => {
  it("保留引用链 sprite（含 die 骰面），删除孤儿", () => {
    const sprites: Sprite[] = [
      { id: "sp-face", url: "f" },
      { id: "sp-back", url: "b" },
      { id: "sp-die1", url: "d1" },
      { id: "sp-die2", url: "d2" },
      { id: "sp-orphan", url: "o" },
    ];
    const prefabs: Prefab[] = [
      { kind: "card", id: "p-card", faces: { front: "sp-face", back: "sp-back" } },
      { kind: "die", id: "p-die", sides: 6, faces: ["sp-die1", "sp-die2"] },
    ];
    const used = entity("c", 0, 0, { prefabId: "p-card" });
    const usedDie = entity("d", 0, 0, { kind: "die", prefabId: "p-die", value: 1, sides: 6 });
    const pruned = pruneUnusedAssets({ sprites, prefabs }, [used, usedDie]);
    expect(pruned.sprites.map((s) => s.id).sort()).toEqual(["sp-back", "sp-die1", "sp-die2", "sp-face"]);
    expect(pruned.prefabs).toHaveLength(2);
  });
});
