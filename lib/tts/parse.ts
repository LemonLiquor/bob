// ============================================================
// TTS 图包解析 — Save JSON → 库存清单（S1：分析与匹配，不产出桌游包）
// 图片文件名 = TTS 本地缓存命名（URL 去掉非字母数字字符）
// ============================================================

/** TTS 对象（只用到的字段，宽松可选） */
export interface TtsObject {
  Name?: string;
  Nickname?: string;
  Description?: string;
  Transform?: { posX: number; posY: number; posZ: number; rotX: number; rotY: number; rotZ: number; scaleX: number; scaleY: number; scaleZ: number };
  ContainedObjects?: TtsObject[];
  CustomDeck?: Record<string, TtsCustomDeck>;
  DeckID?: number;
  CardID?: number;
  CustomImage?: string;
  CustomUI?: { ImageURL?: string } & Record<string, unknown>;
  MeshURL?: string;
  DiffuseURL?: string;
  MaterialURL?: string;
  LuaScript?: string;
  [key: string]: unknown;
}

export interface TtsCustomDeck {
  FaceURL?: string;
  BackURL?: string;
  NumWidth?: number;
  NumHeight?: number;
  Type?: number;
  UniqueBack?: number;
}

/** 库存清单：S1 产物 */
export interface TtsInventory {
  saveName: string;
  objectCount: number;
  /** 类型分布（含嵌套） */
  types: Record<string, number>;
  /** 牌堆/图集定义（Deck 对象 + 其 ContainedObjects） */
  decks: {
    nickname: string;
    faceKey: string; // 拍平后的本地文件名（去扩展名匹配）
    backKey: string | null;
    grid: { w: number; h: number };
    cardCount: number;
  }[];
  /** 图片匹配 */
  images: { referenced: number; matched: number; missing: string[] };
  /** v1 跳过清单（类型 → 数量） */
  skipped: Record<string, number>;
  /** 可导入对象计数 */
  importable: { cards: number; decks: number; tokens: number; tiles: number; boards: number; bags: number; dice: number; counters: number };
}

/** TTS 本地缓存文件名：URL 去掉全部非字母数字字符（防御：非字符串原样返回空） */
export function flattenUrl(url: string | undefined | null): string {
  if (typeof url !== "string") return "";
  return url.replace(/[^a-zA-Z0-9]/g, "");
}

/** 从文件名取 key（去扩展名，小写化用于匹配）——TTS 引用的 URL 无扩展名，本地缓存文件有 */
function fileKey(filename: string): string {
  const base = filename.replace(/\.(png|jpe?g|tiff?|webp)$/i, "");
  return flattenUrl(base).toLowerCase();
}

/** 遍历对象树（含嵌套 ContainedObjects）：depth = 嵌套深度（0 = 桌面顶层） */
export function walkObjects(objs: TtsObject[] | undefined, visit: (o: TtsObject, depth: number) => void): void {
  const walk = (objs: TtsObject[] | undefined, depth: number) => {
    for (const o of objs ?? []) {
      visit(o, depth);
      walk(o.ContainedObjects, depth + 1);
    }
  };
  walk(objs, 0);
}

/** 解析 Save json → 库存清单。images = 用户提供的本地文件名列表（Images 文件夹） */
export function parseTtsSave(save: { SaveName?: string; ObjectStates?: TtsObject[] }, imageFiles: string[]): TtsInventory {
  const inv: TtsInventory = {
    saveName: save.SaveName ?? "(未命名)",
    objectCount: 0,
    types: {},
    decks: [],
    images: { referenced: 0, matched: 0, missing: [] },
    skipped: {},
    importable: { cards: 0, decks: 0, tokens: 0, tiles: 0, boards: 0, bags: 0, dice: 0, counters: 0 },
  };

  // 本地文件索引：拍平 key（去扩展名小写）→ 原文件名
  const fileIndex = new Map<string, string>();
  for (const f of imageFiles) fileIndex.set(fileKey(f), f);

  const referencedUrls = new Set<string>();
  const ref = (url: unknown) => {
    if (typeof url !== "string" || !url) return;
    referencedUrls.add(url);
  };

  const SKIP_TYPES = new Set([
    "Custom_Assetbundle", "3DText", "Chip", "GameKey", "Notecard", "RPG Figurine",
    "Backgammon_Short", "backgammon_piece_brown", "backgammon_piece_white",
    "Chinese_Checkers_Piece", "Checker_black", "Checker_white", "Go_Stone_black", "Go_Stone_white",
  ]);
  // 等效映射分类
  const isBag = (name: string) => name === "Bag" || name === "Infinite_Bag" || name === "Custom_Model_Bag";
  const isDie = (name: string) => name.startsWith("Die_") || name === "Custom_Dice";
  const isCounter = (name: string) => name === "Counter";

  walkObjects(save.ObjectStates, (o) => {
    inv.objectCount++;
    const name = o.Name ?? "Unknown";
    inv.types[name] = (inv.types[name] ?? 0) + 1;

    // 图片引用收集（各类自定义对象）
    ref(o.CustomImage);
    ref(o.MeshURL);
    ref(o.DiffuseURL);
    ref(o.MaterialURL);
    const ui = o.CustomUI as { ImageURL?: string } | undefined;
    ref(ui?.ImageURL);
    for (const cd of Object.values(o.CustomDeck ?? {})) {
      ref(cd.FaceURL);
      ref(cd.BackURL);
    }

    // Deck：图集定义 + 卡数
    if (name === "Deck" && o.CustomDeck) {
      for (const cd of Object.values(o.CustomDeck)) {
        ref(cd.FaceURL);
        ref(cd.BackURL);
        inv.decks.push({
          nickname: o.Nickname ?? "(未命名牌堆)",
          faceKey: cd.FaceURL ? flattenUrl(cd.FaceURL).toLowerCase() : "",
          backKey: cd.BackURL ? flattenUrl(cd.BackURL).toLowerCase() : null,
          grid: { w: cd.NumWidth ?? 1, h: cd.NumHeight ?? 1 },
          cardCount: o.ContainedObjects?.length ?? 0,
        });
      }
      inv.importable.decks++;
      return;
    }

    if (isBag(name)) inv.importable.bags++;
    else if (isDie(name)) inv.importable.dice++;
    else if (isCounter(name)) inv.importable.counters++;
    else if (name === "Card") inv.importable.cards++;
    else if (name === "Custom_Token") inv.importable.tokens++;
    else if (name === "Custom_Tile") inv.importable.tiles++;
    else if (name === "Custom_Board") inv.importable.boards++;
    else if (SKIP_TYPES.has(name) || name.startsWith("backgammon") || name.startsWith("Chinese")) inv.skipped[name] = (inv.skipped[name] ?? 0) + 1;
  });

  // 图片匹配
  for (const url of referencedUrls) {
    const key = flattenUrl(url).toLowerCase();
    if (fileIndex.has(key)) inv.images.matched++;
    else {
      inv.images.missing.push(url);
    }
  }
  inv.images.referenced = referencedUrls.size;

  return inv;
}
