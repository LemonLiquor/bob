import type { EntityState, GameState, Pile, Prefab, Rotation, Sprite } from "../engine/types";
import { walkObjects, flattenUrl, type TtsObject } from "./parse";

// ============================================================
// TTS 状态映射（S3）— Save 对象树 → 标准桌游包（meta + assets + initialState）
// 卡牌自描述（实测确认）：每张卡自带 CustomDeck + CardID；
//   图集键 = floor(CardID / 100)，格序号 = CardID - 键×100（行优先展开）
// 等效映射：袋 → pile（无限袋内容 ×5，内容物按类型发放）、
//   Die/Custom_Dice → die（F 掷骰）、Counter → die（±1）、
//   Custom_Model（3D 棋子）→ token（DiffuseURL 贴图平面化）
// canvas 依赖通过 deps 注入（浏览器传真实现，测试传桩）
// ============================================================

export interface TtsImageSource {
  dataUrl: string;
  width: number;
  height: number;
}

/** images key = 拍平小写无扩展名（与 parse.ts 的匹配键一致） */
export interface TtsBuildDeps {
  images: Map<string, TtsImageSource>;
  cutAtlas: (
    src: TtsImageSource,
    cols: number,
    rows: number,
  ) => Promise<{ col: number; row: number; dataUrl: string; width: number; height: number }[]>;
}

export interface TtsBuildResult {
  meta: { id: string; name: string; icon: string };
  assets: { sprites: Sprite[]; prefabs: Prefab[] };
  initialState: GameState;
  report: {
    sprites: number;
    prefabs: number;
    entities: number;
    piles: number;
    skipped: Record<string, number>;
    warnings: string[];
  };
}

// 基线标定（用户定）：掉落牌堆的卡（TTS 标准卡网格 2.5×3.5 × scale 1.4）= BOB 标准卡 120×168
// → K = 120 / (2.5×1.4) ≈ 34.29 px/单位；其他组件尺寸 = TTS 单位 × K × 各自 scale
const TTS_UNIT_PX = 120 / 3.5; // ≈ 34.29
const CARD_UNITS = { w: 2.5, h: 3.5 }; // TTS 标准卡网格
const PLANE_UNITS = 2; // Custom_Token/Tile 默认平面网格（假设 2×2，实测可调）
const DIE_UNITS = 0.75; // 标准骰网格
const MIN_SIDE = 32; // 非卡实体最小边（过小不可点）
/** 无限袋内容复制倍数（"无限补给"的实用近似） */
const INFINITE_BAG_MULTIPLY = 5;
const COUNTER_SIDES = 20; // 计数器数字范围（±1 调整，die 原语承载）

const asRotation = (rotY: number): Rotation => {
  const norm = (((Math.round(rotY / 90) * 90) % 360) + 360) % 360;
  return norm as Rotation;
};

export async function buildTtsGame(
  save: { SaveName?: string; ObjectStates?: TtsObject[] },
  deps: TtsBuildDeps,
): Promise<TtsBuildResult> {
  const warnings: string[] = [];
  const skipped: Record<string, number> = {};
  const sprites: Sprite[] = [];
  const prefabs: Prefab[] = [];

  // ---------- pass 1：遍历对象树，分类登记 + 收集需要的图集格 ----------
  const faceMeta = new Map<string, { cols: number; rows: number; backKey?: string }>(); // faceKey → 网格/背面
  const neededCells = new Map<string, Set<number>>(); // key（face 或 back）→ 格序号集合
  const looseCards: TtsObject[] = [];
  const containers: TtsObject[] = [];
  const tokenObjs: TtsObject[] = [];
  const dieObjs: TtsObject[] = [];

  const registerCell = (key: string, cell: number) => {
    if (!neededCells.has(key)) neededCells.set(key, new Set());
    neededCells.get(key)!.add(cell);
  };

  function isBag(name: string): boolean {
    return name === "Bag" || name === "Infinite_Bag" || name === "Custom_Model_Bag";
  }
  /** 对象的自定义图 URL：CustomImage/CustomUI 为对象（取 ImageURL），字符串则直取 */
  function imageOf(o: TtsObject): string | undefined {
    const ci = o.CustomImage as { ImageURL?: string } | string | undefined;
    const ui = o.CustomUI as { ImageURL?: string } | string | undefined;
    const candidates = [
      typeof ci === "string" ? ci : ci?.ImageURL,
      typeof ui === "string" ? ui : ui?.ImageURL,
      o.DiffuseURL, // 3D 模型棋子的贴图 → 平面化等效
    ];
    for (const c of candidates) if (typeof c === "string" && c) return c;
    return undefined;
  }
  function objName(o: TtsObject): string {
    return o.Nickname ?? o.Name ?? "Unknown";
  }

  /** 登记一张卡的图集格（正面 + 背面）；返回图集 faceKey */
  function registerCardCells(card: TtsObject, fallbackHost?: TtsObject): string | undefined {
    if (typeof card.CardID !== "number") return undefined; // token/袋/die 等非卡内容物：静默跳过
    const cardId = card.CardID;
    const key = Math.floor(cardId / 100);
    const cell = cardId - key * 100;
    const atlas =
      (card.CustomDeck ?? {})[String(key)] ?? (fallbackHost?.CustomDeck ?? {})[String(key)];
    if (!atlas?.FaceURL) {
      warnings.push(`卡牌缺少图集：${objName(card)}`);
      return undefined;
    }
    const faceKey = flattenUrl(atlas.FaceURL).toLowerCase();
    const backKey = atlas.BackURL ? flattenUrl(atlas.BackURL).toLowerCase() : undefined;
    if (!faceMeta.has(faceKey)) {
      faceMeta.set(faceKey, { cols: atlas.NumWidth ?? 1, rows: atlas.NumHeight ?? 1, backKey });
      if (backKey) neededCells.set(backKey, new Set());
    }
    // 卡背图集也登记网格（修复：此前 back key 无 meta → 按 1×1 切 → 只有 0 号格有卡背）
    if (backKey && !faceMeta.has(backKey)) {
      faceMeta.set(backKey, atlas.UniqueBack ? { cols: 1, rows: 1 } : { cols: atlas.NumWidth ?? 1, rows: atlas.NumHeight ?? 1 });
    }
    const meta = faceMeta.get(faceKey)!;
    if (cell >= meta.cols * meta.rows) {
      warnings.push(`CardID 超出图集网格：${objName(card)}（cell ${cell} ≥ ${grid(meta)}）`);
      return undefined;
    }
    registerCell(faceKey, cell);
    if (backKey) registerCell(backKey, atlas.UniqueBack ? 0 : cell);
    return faceKey;
  }
  const grid = (meta: { cols: number; rows: number }) => meta.cols * meta.rows;

  walkObjects(save.ObjectStates, (o, depth) => {
    const name = o.Name ?? "Unknown";
    if (name.startsWith("Die_") || name === "Custom_Dice" || name === "Counter") {
      dieObjs.push(o); // 先于卡牌分支：Custom_Dice 自带 CustomDeck 会被误认成散卡
      return;
    }
    if (name === "Deck" || isBag(name)) {
      containers.push(o);
      for (const c of o.ContainedObjects ?? []) registerCardCells(c, o);
      return;
    }
    if (o.CustomDeck && o.CardID !== undefined) {
      if (depth === 0 && o.ContainedObjects === undefined) {
        looseCards.push(o);
        registerCardCells(o, o);
      }
      return; // 容器成员：由所属 Deck/Bag 的发放统一处理
    }
    if (name === "Custom_Token" || name === "Custom_Tile" || name === "Custom_Model") {
      if (!imageOf(o)) {
        skipped[name] = (skipped[name] ?? 0) + 1;
        return;
      }
      tokenObjs.push(o);
      registerCell(flattenUrl(imageOf(o)!).toLowerCase(), 0);
      return;
    }
    skipped[name] = (skipped[name] ?? 0) + 1;
  });

  // ---------- pass 2：切割（每个唯一 key 一次），登记 sprite ----------
  const spriteByCell = new Map<string, Sprite>(); // `${key}#${cell}` → sprite
  for (const [key, cells] of neededCells) {
    const src = deps.images.get(key);
    if (!src) {
      warnings.push(`图集缺失本地图片：${key.slice(0, 50)}（其卡牌将被跳过）`);
      continue;
    }
    const meta = faceMeta.get(key);
    const cols = meta?.cols ?? 1;
    const rows = meta?.rows ?? 1;
    const cut = await deps.cutAtlas(src, cols, rows);
    for (const c of cut) {
      const cell = c.row * cols + c.col;
      if (!cells.has(cell)) continue; // 只保留需要的格
      const sprite: Sprite = { id: `spr-tts-${sprites.length}`, url: c.dataUrl };
      sprites.push(sprite);
      spriteByCell.set(`${key}#${cell}`, sprite);
    }
  }

  // ---------- pass 3：prefab / 实体 / 牌堆发放 ----------
  const entities: EntityState[] = [];
  const piles: Pile[] = [];
  const cardPrefabByCell = new Map<string, Prefab>(); // `${faceKey}#${cell}` → prefab

  const toWorld = (t: TtsObject["Transform"]) => ({
    x: Math.round((t?.posX ?? 0) * TTS_UNIT_PX),
    y: Math.round((t?.posZ ?? 0) * TTS_UNIT_PX),
    z: Math.round((t?.posY ?? 0) * 100),
    rotation: asRotation(t?.rotY ?? 0),
  });

  const ensureCardPrefab = (faceKey: string, cell: number, scaleX: number, scaleZ: number): Prefab | undefined => {
    const k = `${faceKey}#${cell}`;
    const existing = cardPrefabByCell.get(k);
    if (existing) return existing;
    const front = spriteByCell.get(`${faceKey}#${cell}`);
    if (!front) return undefined;
    const meta = faceMeta.get(faceKey)!;
    const back = meta.backKey ? spriteByCell.get(`${meta.backKey}#${cell}`) : undefined;
    const prefab: Prefab = {
      kind: "card",
      id: `prefab-tts-${prefabs.length}`,
      faces: { front: front.id, back: back?.id ?? "" },
      size: {
        width: Math.round(CARD_UNITS.w * scaleX * TTS_UNIT_PX),
        height: Math.round(CARD_UNITS.h * scaleZ * TTS_UNIT_PX),
      },
    };
    prefabs.push(prefab);
    cardPrefabByCell.set(k, prefab);
    return prefab;
  };

  const emitCard = (
    card: TtsObject,
    fallbackHost: TtsObject | undefined,
    pos: { x: number; y: number; z: number; rotation: Rotation },
  ): EntityState | undefined => {
    const faceKey = registerCardCells(card, fallbackHost);
    if (!faceKey) return undefined;
    const cell = (card.CardID as number) - Math.floor((card.CardID as number) / 100) * 100;
    const t = card.Transform;
    const prefab = ensureCardPrefab(faceKey, cell, t?.scaleX ?? 1, t?.scaleZ ?? 1);
    if (!prefab) return undefined;
    const entity: EntityState = {
      id: `inst-tts-${entities.length}`,
      prefabId: prefab.id,
      kind: "card",
      faceUp: false,
      rotation: pos.rotation,
      x: pos.x,
      y: pos.y,
      zIndex: pos.z,
      size: prefab.size, // BOB 约定：构建时复制到实体（堆叠判定/渲染用）
    };
    entities.push(entity);
    return entity;
  };

  const emitToken = (o: TtsObject, pos: { x: number; y: number; z: number; rotation: Rotation }): EntityState | undefined => {
    const img = imageOf(o)!;
    const key = flattenUrl(img).toLowerCase();
    const sprite = spriteByCell.get(`${key}#0`);
    const src = deps.images.get(key);
    if (!sprite || !src) return undefined;
    const t = o.Transform;
    const w0 = Math.max(MIN_SIDE, Math.round(PLANE_UNITS * (t?.scaleX ?? 1) * TTS_UNIT_PX));
    const h0 = Math.max(MIN_SIDE, Math.round(PLANE_UNITS * (t?.scaleZ ?? 1) * TTS_UNIT_PX));
    const prefab: Prefab = {
      kind: "token",
      id: `prefab-tts-${prefabs.length}`,
      faces: { front: sprite.id },
      size: { width: w0, height: h0 },
    };
    prefabs.push(prefab);
    const entity: EntityState = {
      id: `inst-tts-${entities.length}`,
      prefabId: prefab.id,
      kind: "token",
      faceUp: true,
      rotation: pos.rotation,
      x: pos.x,
      y: pos.y,
      zIndex: pos.z,
      size: prefab.size,
    };
    entities.push(entity);
    return entity;
  };

  const emitDie = (o: TtsObject, pos: { x: number; y: number; z: number; rotation: Rotation }): EntityState | undefined => {
    const name = o.Name ?? "";
    const sides = name === "Die_8" ? 8 : name === "Counter" ? COUNTER_SIDES : 6;
    const count = typeof (o as { Count?: number }).Count === "number" ? (o as { Count: number }).Count : 1;
    const t = o.Transform;
    const d0 = Math.max(MIN_SIDE, Math.round(DIE_UNITS * (t?.scaleX ?? 1) * TTS_UNIT_PX));
    const prefab: Prefab = { kind: "die", id: `prefab-tts-${prefabs.length}`, sides, size: { width: d0, height: d0 } };
    prefabs.push(prefab);
    const entity: EntityState = {
      id: `inst-tts-${entities.length}`,
      prefabId: prefab.id,
      kind: "die",
      faceUp: true,
      rotation: 0,
      value: Math.min(sides, Math.max(1, Math.round(count))),
      sides,
      x: pos.x,
      y: pos.y,
      zIndex: pos.z,
      size: prefab.size,
    };
    entities.push(entity);
    return entity;
  };

  const emitContainer = (host: TtsObject, multiply: number): void => {
    const w = toWorld(host.Transform);
    const members: string[] = [];
    const contents = host.ContainedObjects ?? [];
    for (let copy = 0; copy < multiply; copy++) {
      for (const contained of contents) {
        const pos = { ...w, z: w.z - copy };
        const cname = contained.Name ?? "Unknown";
        if (cname.startsWith("Die_") || cname === "Custom_Dice" || cname === "Counter") {
          const entity = emitDie(contained, pos);
          if (entity) members.push(entity.id);
          continue;
        }
        if (contained.CardID !== undefined && !contained.ContainedObjects?.length) {
          const entity = emitCard(contained, host, pos);
          if (entity) members.push(entity.id);
          continue;
        }
        const name = contained.Name ?? "Unknown";
        if (name === "Custom_Token" || name === "Custom_Tile" || name === "Custom_Model") {
          if (imageOf(contained)) {
            const entity = emitToken(contained, pos);
            if (entity) members.push(entity.id);
            continue;
          }
        }
        warnings.push("容器内容物暂不支持：" + objName(contained));
      }
    }
    // TTS ContainedObjects[0] = 顶牌 → BOB entityIds 从下到上：反转
    piles.push({ id: `pile-tts-${piles.length}`, entityIds: members.reverse(), x: w.x, y: w.y });
  };

  for (const host of containers) {
    emitContainer(host, host.Name === "Infinite_Bag" ? INFINITE_BAG_MULTIPLY : 1);
  }
  for (const card of looseCards) {
    emitCard(card, undefined, toWorld(card.Transform));
  }
  for (const o of tokenObjs) {
    emitToken(o, toWorld(o.Transform));
  }
  for (const o of dieObjs) {
    emitDie(o, toWorld(o.Transform));
  }

  return {
    meta: { id: `tts-${Date.now()}`, name: save.SaveName ?? "TTS 图包", icon: "🎲" },
    assets: { sprites, prefabs },
    initialState: { entities, piles, seats: [] },
    report: {
      sprites: sprites.length,
      prefabs: prefabs.length,
      entities: entities.length,
      piles: piles.length,
      skipped,
      warnings,
    },
  };
}
