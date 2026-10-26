import { z } from "zod";

/**
 * 请求体的运行时校验。类型断言（`as ClientMessage`）编译期就擦掉了，
 * 线上收到什么形状的 JSON 都拦不住——这里用 zod 把形状真正检查一遍。
 *
 * 命名与 lib/engine/types.ts 对齐：schema 是那道「数据落盘前的门」，
 * 形状必须和引擎消费的字段一致，否则存进 JSON 的东西服务端自己读不出来。
 */

/** 单次上传的体积上限。整包 assets 是 base64 dataURL，正常桌游 1~3MB */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export const SessionBody = z.object({
  name: z.string().trim().min(1, "昵称不能为空").max(24, "昵称最长 24 字"),
});

const Size = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

const Sprite = z.object({
  id: z.string().min(1),
  // 图必须是内联 dataURL：上传后服务端只存 JSON，不做对象存储，
  // 放过 http(s) 外链会让「桌游包」依赖外部资源，离线打开就花屏
  url: z
    .string()
    .min(1)
    .refine((u) => u.startsWith("data:"), { message: "必须是 dataURL" }),
});

const Prefab = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("card"),
    id: z.string().min(1),
    faces: z.object({ front: z.string(), back: z.string() }),
    size: Size.optional(),
  }),
  z.object({
    kind: z.literal("token"),
    id: z.string().min(1),
    faces: z.object({ front: z.string(), back: z.string().optional() }),
    size: Size.optional(),
  }),
  z.object({
    kind: z.literal("board"),
    id: z.string().min(1),
    faces: z.object({ front: z.string() }),
    size: Size.optional(),
  }),
  z.object({
    kind: z.literal("die"),
    id: z.string().min(1),
    sides: z.number().int().min(2),
    faces: z.array(z.string()).optional(),
    tint: z.string().optional(),
    label: z.string().optional(),
    size: Size.optional(),
  }),
]);

const Entity = z.object({
  id: z.string().min(1),
  prefabId: z.string().min(1),
  kind: z.enum(["card", "token", "board", "die"]),
  faceUp: z.boolean(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  value: z.number().optional(),
  sides: z.number().optional(),
  x: z.number(),
  y: z.number(),
  zIndex: z.number(),
  parentId: z.string().optional(),
  size: Size.optional(),
});

const Pile = z.object({
  id: z.string().min(1),
  entityIds: z.array(z.string()),
  x: z.number(),
  y: z.number(),
  parentId: z.string().optional(),
});

const Seat = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  label: z.string(),
  playerId: z.string().optional(),
  playerName: z.string().optional(),
  score: z.number(),
  handZone: z.object({ entityIds: z.array(z.string()) }),
});

const GameState = z.object({
  entities: z.array(Entity),
  piles: z.array(Pile),
  seats: z.array(Seat),
});

export const GameBody = z.object({
  meta: z.object({
    id: z.string().min(1).max(64),
    name: z.string().trim().min(1, "桌游名不能为空").max(40, "桌游名最长 40 字"),
    icon: z.string().min(1),
  }),
  assets: z.object({
    // 条数上限只为兜住「恶意/坏数据塞十万条把服务端内存打满」，
    // 正常桌游：精灵图几十到几百，模板同量级
    sprites: z.array(Sprite).max(5000, "精灵图数量超上限"),
    prefabs: z.array(Prefab).max(2000, "模板数量超上限"),
  }),
  initialState: GameState,
});

/** 把 zod 的第一条错误变成一句人话：「assets.sprites.0.url: 必须是 dataURL」 */
export function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "请求体不合法";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
