import type { EntityState, GameState, Pile, Prefab, Rotation, Sprite } from "../engine/types";
import { walkObjects, flattenUrl, type TtsObject } from "./parse";

// ============================================================
// TTS 状态映射（S3）— Save 对象树 → 标准桌游包（meta + assets + initialState）
// 卡牌自描述（实测确认）：每张卡自带 CustomDeck + CardID；
//   图集键 = floor(CardID / 100)，格序号 = CardID - 键×100（行优先展开）
// 卡背（TTS 语义，实测真实 TTS 模组确认）：UniqueBack=1 → BackURL 与正面同网格（每卡独立背）；
//   UniqueBack=0 → BackURL 为整副共用的一张完整卡背图（按 1×1 切，所有卡取 0 号格）
// 等效映射：袋 → pile（无限袋内容 ×5，内容物按类型发放）、
//   Die/Custom_Dice → die（F 掷骰）、Counter → die（±1）、
//   Custom_Model（3D 棋子）→ token（DiffuseURL 贴图平面化）
// 降级映射：Custom_Tile/Custom_Token 双面（ImageSecondaryURL → token back，可翻，如说明书两页）；
//   无法等效映射的组件（Assetbundle 3D 模型、内置棋子区域标记等）→ 黄便签占位
//   标记（名字 + 待实现），玩家可自行替代
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
  /** 占位标记贴图（名字 + 待实现便签）；同一 label 只生成一次 */
  makeMarker: (label: string) => { dataUrl: string; width: number; height: number };
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
    markers: number;
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
// TTS 自定义骰贴图模板（实测真实 TTS 模组确认）：3×3 网格，顶行 3 格为底色占位；1..6 点 = 格 3..8（行优先）
const DIE_FACE_GRID = { cols: 3, rows: 3 };
const DIE_FACE_BASE = 3;
const MARKER_MIN_W = 80; // 占位标记最小边（便签文字可读）
/** 无法等效映射 → 生成占位标记的类型（3D 模型/内置棋子区域标记）；其余无名类型静默跳过 */
const MARKER_3D_TYPES = new Set(["Custom_Assetbundle", "Custom_Model"]);
const SILENT_SKIP_TYPES = new Set(["3DText", "Chinese_Checkers_Piece"]); // 装饰/mod 工具，不值得占位
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
  const markerObjs: TtsObject[] = [];

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
  /** 双面 tile/token 的背面图（CustomImage.ImageSecondaryURL；字符串形态无背面） */
  function secondaryOf(o: TtsObject): string | undefined {
    const ci = o.CustomImage;
    const u = typeof ci === "object" ? ci?.ImageSecondaryURL : undefined;
    return typeof u === "string" && u ? u : undefined;
  }
  /** 占位标记文字：有昵称用昵称，否则按类型给兜底名 */
  function markerLabelOf(o: TtsObject): string {
    return (o.Nickname ?? "").trim() || (o.Name === "Custom_Assetbundle" ? "3D 组件" : "3D 模型");
  }
  /** 单图实体（token/tile/模型平面化）的图集登记：正面 + 可选背面，各按 1×1 切 */
  function registerImageCells(frontUrl: string, backUrl?: string): void {
    const key = flattenUrl(frontUrl).toLowerCase();
    if (!faceMeta.has(key)) faceMeta.set(key, { cols: 1, rows: 1 });
    registerCell(key, 0);
    if (backUrl) {
      const bk = flattenUrl(backUrl).toLowerCase();
      if (!faceMeta.has(bk)) faceMeta.set(bk, { cols: 1, rows: 1 });
      registerCell(bk, 0);
    }
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
    // 卡背图集登记网格。TTS 语义：UniqueBack=1 → 背面与正面同网格（每卡独立背）；
    // UniqueBack=0 → BackURL 为整副共用的单张完整卡背图（按 1×1 切，所有卡取 0 号格）
    if (backKey && !faceMeta.has(backKey)) {
      faceMeta.set(backKey, atlas.UniqueBack ? { cols: atlas.NumWidth ?? 1, rows: atlas.NumHeight ?? 1 } : { cols: 1, rows: 1 });
    }
    const meta = faceMeta.get(faceKey)!;
    if (cell >= meta.cols * meta.rows) {
      warnings.push(`CardID 超出图集网格：${objName(card)}（cell ${cell} ≥ ${grid(meta)}）`);
      return undefined;
    }
    registerCell(faceKey, cell);
    if (backKey) registerCell(backKey, atlas.UniqueBack ? cell : 0);
    return faceKey;
  }
  const grid = (meta: { cols: number; rows: number }) => meta.cols * meta.rows;

  walkObjects(save.ObjectStates, (o, depth) => {
    const name = o.Name ?? "Unknown";
    if (name.startsWith("Die_") || name === "Custom_Dice" || name === "Counter") {
      dieObjs.push(o); // 先于卡牌分支：Custom_Dice 自带 CustomDeck 会被误认成散卡
      // Custom_Dice 骰面贴图：按 TTS 自定义骰模板切 1..6 点（格 3..8；标准 Die_* 无图走数字面）
      const ci = o.CustomImage;
      const dieUrl = typeof ci === "object" ? ci?.ImageURL : undefined;
      if (typeof dieUrl === "string" && dieUrl) {
        const key = flattenUrl(dieUrl).toLowerCase();
        if (!faceMeta.has(key)) faceMeta.set(key, { cols: DIE_FACE_GRID.cols, rows: DIE_FACE_GRID.rows });
        for (let i = 0; i < 6; i++) registerCell(key, DIE_FACE_BASE + i);
      }
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
    if (name === "Custom_Token" || name === "Custom_Tile" || name === "Custom_Model" || name === "Custom_Assetbundle") {
      const front = imageOf(o);
      if (!front) {
        // 无图可平面化：3D 模型类 → 占位标记（名字 + 待实现）；其余静默跳过
        if (MARKER_3D_TYPES.has(name)) markerObjs.push(o);
        else skipped[name] = (skipped[name] ?? 0) + 1;
        return;
      }
      // 袋内 token 由 emitContainer 统一发入牌堆（此处只登记图，防双发）；桌面顶层直接发放
      if (depth === 0) tokenObjs.push(o);
      registerImageCells(front, secondaryOf(o));
      return;
    }
    // 其余类型：内置棋子（区域标记）/装饰/工具等
    if (SILENT_SKIP_TYPES.has(name)) {
      skipped[name] = (skipped[name] ?? 0) + 1;
    } else if (MARKER_3D_TYPES.has(name) || name.startsWith("backgammon") || (o.Nickname ?? "").trim()) {
      markerObjs.push(o); // 有名组件留占位（玩家可自行替代）；无名且非 3D 的静默跳过
    } else {
      skipped[name] = (skipped[name] ?? 0) + 1;
    }
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

  // ---------- pass 2.5：占位标记贴图（同一 label 复用一张便签） ----------
  const markerSpriteByLabel = new Map<string, Sprite>();
  for (const o of markerObjs) {
    const label = markerLabelOf(o);
    if (markerSpriteByLabel.has(label)) continue;
    const img = deps.makeMarker(label);
    const sprite: Sprite = { id: `spr-tts-${sprites.length}`, url: img.dataUrl };
    sprites.push(sprite);
    markerSpriteByLabel.set(label, sprite);
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
    // 卡背取格：UniqueBack=1 → 与卡同格；=0 → 整副共用单张完整卡背（1×1 图集，恒 0 号格）
    const backMeta = meta.backKey ? faceMeta.get(meta.backKey) : undefined;
    const backCell = backMeta && backMeta.cols * backMeta.rows === 1 ? 0 : cell;
    const back = meta.backKey ? spriteByCell.get(`${meta.backKey}#${backCell}`) : undefined;
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
    // 双面 tile（ImageSecondaryURL，如说明书第 1/2 页）→ token back，可翻
    const backUrl = secondaryOf(o);
    const back = backUrl ? spriteByCell.get(`${flattenUrl(backUrl).toLowerCase()}#0`) : undefined;
    const prefab: Prefab = {
      kind: "token",
      id: `prefab-tts-${prefabs.length}`,
      faces: back ? { front: sprite.id, back: back.id } : { front: sprite.id },
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

  /** ColorDiffuse（0..1）→ CSS 十六进制着色 */
  const rgbToHex = (c: { r: number; g: number; b: number }): string =>
    "#" + [c.r, c.g, c.b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");

  const emitDie = (o: TtsObject, pos: { x: number; y: number; z: number; rotation: Rotation }): EntityState | undefined => {
    const name = o.Name ?? "";
    const sides = name === "Die_8" ? 8 : name === "Counter" ? COUNTER_SIDES : 6;
    const count = typeof (o as { Count?: number }).Count === "number" ? (o as { Count: number }).Count : 1;
    const t = o.Transform;
    const d0 = Math.max(MIN_SIDE, Math.round(DIE_UNITS * (t?.scaleX ?? 1) * TTS_UNIT_PX));
    // TTS 自定义骰骰面：faces[v-1] = 点数 v 的面图（3×3 模板格 3..8）；标准骰无图 → 数字面 + ColorDiffuse 着色
    const ci = o.CustomImage;
    const dieUrl = typeof ci === "object" ? ci?.ImageURL : undefined;
    let faces: string[] | undefined;
    if (typeof dieUrl === "string" && dieUrl) {
      const key = flattenUrl(dieUrl).toLowerCase();
      const ids = [0, 1, 2, 3, 4, 5].map((i) => spriteByCell.get(`${key}#${DIE_FACE_BASE + i}`)?.id);
      if (ids.every(Boolean)) faces = ids as string[];
    }
    const tint = o.ColorDiffuse ? rgbToHex(o.ColorDiffuse) : undefined;
    const label = (o.Nickname ?? "").trim() || undefined;
    const prefab: Prefab = {
      kind: "die",
      id: `prefab-tts-${prefabs.length}`,
      sides,
      ...(faces ? { faces } : {}),
      ...(tint ? { tint } : {}),
      ...(label ? { label } : {}),
      size: { width: d0, height: d0 },
    };
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

  /** 占位标记 token：黄便签（名字 + 待实现），摆在该组件原位置，玩家可自行替代 */
  const emitMarker = (o: TtsObject, pos: { x: number; y: number; z: number; rotation: Rotation }): EntityState | undefined => {
    const sprite = markerSpriteByLabel.get(markerLabelOf(o));
    if (!sprite) return undefined;
    const t = o.Transform;
    const w0 = Math.max(MARKER_MIN_W, Math.round(PLANE_UNITS * (t?.scaleX ?? 1) * TTS_UNIT_PX));
    const h0 = Math.round(w0 * 0.75); // 便签贴图 4:3，避免 object-cover 裁字
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
        if (name === "Custom_Token" || name === "Custom_Tile" || name === "Custom_Model" || name === "Custom_Assetbundle") {
          if (imageOf(contained)) {
            const entity = emitToken(contained, pos);
            if (entity) members.push(entity.id);
            continue;
          }
          continue; // 无图 token 类：pass 1 已按占位标记/跳过处理，不重复发放
        }
        if (name === "Deck" || isBag(name)) continue; // 嵌套容器：pass 1 已按独立容器发放
        warnings.push("容器内容物暂不支持：" + objName(contained));
      }
    }
    // TTS ContainedObjects[0] = 顶牌 → BOB entityIds 从下到上：反转。
    // 成员全空（内容物均为嵌套容器/跳过项）的袋不建堆——空堆会在桌面留下虚线框
    // 并注册 droppable 劫持落点，但引擎判定跳过空堆 → 表现为"拖上去堆叠失效"
    if (members.length > 0) {
      piles.push({ id: `pile-tts-${piles.length}`, entityIds: members.reverse(), x: w.x, y: w.y });
    }
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
  for (const o of markerObjs) {
    emitMarker(o, toWorld(o.Transform));
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
      markers: markerObjs.length,
      skipped,
      warnings,
    },
  };
}
