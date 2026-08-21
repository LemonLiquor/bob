# 临时需求文档：导入页重构（资源工厂 + 卡组组装 + 无座初始状态）

> ⚠️ 临时文件：完成需求后删除。正式记录落盘到 docs/architecture.md + docs/notes/implemented.md。
> 验收方式约定：控制台打印 json（url 字段截断显示为 `url.slice(0,60)+…(长度)`，避免 dataURL 刷屏），打印点保留到 S8 清理。

## 背景与目标

上次"美术资源三层模型"（Sprite→Prefab→实例）重构后，导入链路只是"编译级适配"：自动批量生成卡牌、每卡独立背面图，未利用新模型的共享语义。本次将导入页重构为"**PDF → 图片资源池 → 手动卡组组装 → 上传（meta + assets + 无座 initialState）**"，并以固化的 initialState 取代客户端 `buildGame` 的结构派生（坐标仍运行时居中）。

## 数据契约

```
上传内容 = meta { id, name, icon }
        + assets { sprites: Sprite[], prefabs: Prefab[] }   // sprites = 全部切图；prefabs = 卡组摊平
        + initialState: GameState { entities, piles, seats: [] }  // 存档无座；piles 由卡组生成
```

- sprite id 命名 `sprite-{n}`（全局递增，不再分 f/b）；prefab 仍 `prefab-{n}`
- 卡组是**页面内临时结构**（不进协议/存储）：`{ cards: { frontSpriteId, backSpriteId | "" }[] }`，一卡组 → 一个 Pile
- 未进卡组的 sprite 也全量上传（sprite 表全量，prefabs 只引用部分）
- **座位是运行时概念，不进存档**：存档 `seats: []`；创建房间时由服务端补 1 个默认空座（复用 `createSeat`，行为对齐现有 buildGame）

## 交互设计（导入页）

1. **页面多选**：PDF 页面列表（复选框 + 全选）；勾选页后加载该页切割预览（复用 GridPreview）
2. **切割参数**：全局一套（行/列/边距/间隔，沿用现有 CropInput 控件）
3. **图片池**：所有选中页切图网格（~80px 缩略图 + 编号）；点击切换选中（ring 高亮）
4. **卡组组装**：
   - 图片池多选 → 「+ 新建卡组」→ 选中图成为卡正面列表，再从图片池选一张背面图（可跳过 = 默认卡背）
   - 卡组面板内每卡一行 `[正面缩略图][背面缩略图][✕]`；点击任一缩略图进入"替换模式"（该格闪烁）→ 点击图片池任意图完成替换；点空白取消
   - 可建多个卡组（各生成一个牌堆）；卡组可删除
5. **页对预设**（快捷选项，复用 `mirrorBackIndex`，复杂度低）：「自动正反交替组卡」→ 页面按 (1,2),(3,4) 配对，每对生成一个卡组（正面 = 奇数页切图、背面 = 偶数页镜像图）
6. **坐标占位**：上传的 initialState 中牌堆水平排列占位（第 i 个 `x = i*(CARD_WIDTH+24)`，`y = 0`，常量取 `lib/engine/layout.ts`）；实际显示坐标由客户端运行时居中

## 实施步骤（按用户可验收的功能分步）

依赖：1 → 2 → 3 → 4 → 5；6 → 7 → 8。

---

### S1：切图 → 图片资源（控制台打印 sprites json）

**改**：
- `app/(main)/import/page.tsx` 重写页面骨架（上传/卡组功能暂未启用）：
  - 选 PDF → 显示页数；全局切割参数（行/列/边距/间隔，沿用 CropInput 控件）
  - 「切割」按钮：对 PDF **全部页**执行 `cropGrid` → 组装图片池 state：`Sprite[]`（id `sprite-{n}` 全局连续）
  - 图片池网格展示（~80px 缩略图 + 编号）；点击切换选中态（ring 高亮）
  - 切割完成后 `console.log("sprites:", sprites)`（url 截断摘要）
- `lib/pnp/crop.ts`：本次不动（`cropGrid` 已满足）

**验收**：选 PDF → 设行/列 → 点切割 → 图片池显示全部页切图（编号 sprite-0 起连续）；控制台打印 sprites json（id 连续、url 非空、总数 = 页数 × 行 × 列）

---

### S2：选择裁切哪几页（控制台打印选中页 sprites json）

**改**：`app/(main)/import/page.tsx`：
- 新增页面多选列表（复选框 + 全选/全不选），勾选页加载该页切割预览（复用 GridPreview）
- 「切割」只针对勾选页；打印的 sprites json 只含选中页切图（id 仍全局连续）

**验收**：勾选第 1、3 页 → 点切割 → 图片池与控制台 sprites json 只含这 2 页的切图，id 连续无空洞；取消勾选某页 → 重切后该页切图消失

---

### S3：组装卡牌（控制台打印 prefabs json）

**改**：`app/(main)/import/page.tsx`：
- 图片池多选 → 「+ 新建卡组」→ 选中图成为卡正面列表；再从图片池选一张背面图（可跳过 = 默认卡背）
- 卡组面板：每卡一行 `[正面缩略图][背面缩略图][✕]`；点击任一缩略图进入"替换模式"（该格闪烁）→ 点击图片池任意图完成替换；点空白取消；删除单卡 / 删除整个卡组；多卡组共存
- 卡组变化时 `console.log("decks:", decks)`（正面/背面 sprite id 引用）

**验收**：选中 3 图 + 1 背面图 → 新建卡组 → 3 张卡、背面缩略图相同；跳过背面 → 显示"默认卡背"（backSpriteId = ""）；替换正/背面成功；删除单卡/卡组生效；控制台 decks json 引用正确

---

### S4：上传（meta + assets + 无座 initialState，控制台打印完整 payload json）

**改**：
- `lib/pnp/crop.ts`：新增 `Deck` 类型与 `buildGameFromDecks(decks, sprites) → { prefabs, entities, piles }`（prefabs `prefab-{n}`、entities `inst-{n}`、piles 每卡组一个 `pile-{ts}` 占位坐标 `x = i*(CARD_WIDTH+24), y = 0`）
- `lib/multiplayer/protocol.ts`：`upload_game` 增加 `initialState: GameState`
- `server/game-library.ts`：`SavedGame` 增加 `initialState`；`loadAll` 缺失则跳过并 warn（旧 json 不再加载，文件保留）
- `server/handlers.ts`：`upload_game` 保存 initialState
- `app/(main)/import/page.tsx`：`handleImport`——sprites 池（全量）+ `buildGameFromDecks` → `{ meta, assets, initialState }` → 上传前 `console.log("upload:", payload)`；上传按钮启用

**验收**：
- 点上传 → 控制台打印完整 payload json：meta + assets（sprites 全量、prefabs 引用）+ initialState（`seats: []`、piles 每卡组一个、水平占位坐标）
- `server/data/games/<id>.json` 落盘同结构；服务端重启日志旧 json 显示 skip；广场列表只显示新游戏（旧游戏不加载）

---

### S5：页对预设快捷按钮（控制台打印生成的 decks json）

**改**：`app/(main)/import/page.tsx` 新增「自动正反交替组卡」按钮：勾选页按 (1,2),(3,4) 配对，每对生成一个卡组（正面 = 奇数页切图、背面 = 偶数页镜像图，用 `mirrorBackIndex`），与手动卡组共用同一上传路径

**验收**：4 页 PDF 全选 → 一键生成 2 个卡组，卡组面板可见，背面为镜像图；控制台打印的 decks json 背面引用正确（第 i 行 j 列 ↔ 第 i 行 cols-1-j 列）

---

### S6：试玩与开房显示固化的 initialState（视觉验收）

**改**：
- `lib/engine/build-game.ts`：新增 `recenterInitialState(state, boardSize)`——多牌堆整体水平排列后居中（第 i 个 `x = 中心-总宽/2 + i*(CARD_WIDTH+24)`，y 垂直居中）；`buildGame` 暂保留
- `lib/multiplayer/protocol.ts`：`game_data` / `room_created` / `room_joined` 增加 `initialState`
- `server/room-manager.ts`：`createRoom` 改为 `{ ...structuredClone(initialState), seats: [createSeat()] }`
- `server/handlers.ts`：三个分支下发 initialState（深拷贝）
- `app/(main)/games/page.tsx`：`room_created` 分支 `recenterInitialState(msg.initialState, 视口)` → session + `update_game_state` 广播；删除 `buildGame` 引用
- `app/(game)/game/[gameId]/play/page.tsx`：`game_data` 用 `msg.initialState` + recenter；重新开始 = 重新居中；删除 `buildGame` 引用

**验收**：
- 试玩：进页即见牌堆组整体居中于视口；无座自动补虚拟座位可抓牌；ESC 重新开始回初始布局
- 开房：创建者进房牌堆组居中、有一个默认空座可占（与现状一致）；加入者经 state_sync 位置一致
- 广场旧游戏消失（服务端不加载）

---

### S7：多人重新开始（座位保留、手牌清空）

**改**：`app/(game)/room/[code]/page.tsx`：
- 进房 initialState 存 ref；竞态兜底（创建者尚未广播）改为本地 recenter 显示、不发送
- 房主重新开始：`{ ...recenterInitialState(initialState, 视口), seats: 当前 seats 保留实例+归属、仅清空 handZone.entityIds }` → `update_game_state` 广播

**验收**：多人开房 → 玩家入座 → 房主 ESC 重新开始 → 座位实例与归属全保留（玩家无需重新占座）、手牌清空、牌堆回初始居中布局

---

### S8：清理

**改**：删除 `lib/engine/build-game.ts` 的 `buildGame`（已无调用方）；移除验收用 console.log；更新 `docs/architecture.md`"初始状态构建"条目；新增 `docs/notes/implemented.md` 条目；删除本临时文件

**验收**：`grep -r "buildGame" app/ lib/` 无调用残留；`tsc --noEmit` 通过；文档已更新；`docs/TEMP-import-rework.md` 已删除

## 关联

- **依赖**：a4e8654 三层模型重构（已完成）
- **被依赖**：ROADMAP「桌游实体扩充」（本次导入只产卡牌，实体类型扩展留待该需求）
- **文档**：完成后更新 `docs/architecture.md`"初始状态构建"条目 + 新增 implemented note

## 边界（本次不做）

- 卡组命名（牌堆 id 自动 `pile-{ts}`）；每页独立切割参数；导入页内牌堆自由摆放；旧 json 迁移/删除
