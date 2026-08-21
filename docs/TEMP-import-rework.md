# 临时需求文档：导入页重构（资源工厂 + 卡组组装 + 无座初始状态）

> ⚠️ 临时文件：完成需求后删除。正式记录落盘到 docs/architecture.md + docs/notes/implemented.md。
> 验收方式约定：控制台打印 json（url 字段截断显示为 `url.slice(0,60)+…(长度)`，避免 dataURL 刷屏），打印点保留到 S7 清理。

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
- **initialState 坐标由 Lab 自定义**：生成时 entities（x/y/zIndex）与 piles（x/y）坐标默认全 0；上传前进入 Lab 沙盒拖拽调整，保存后坐标写回 initialState；运行时**不再重算坐标**（不做居中），创建房间/试玩直接读 initialState，`buildGame` 删除
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
6. **坐标由 Lab 自定义**：生成 json 时 entities/piles 坐标默认 0；上传前进入 Lab 沙盒（全屏，无座）拖拽移动卡牌与牌堆，保存后坐标写回 initialState；运行时不再重算（创建房间/试玩直接使用；多牌堆由玩家在 Lab 里摆好）

## 实施步骤（按用户可验收的功能分步）

依赖：1 → 2 → 3 → 4a → 4b → 4c → 5；6 → 7。

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

### S4a：生成桌游数据 json（上传前预览）

**能力（改完后）**：填好游戏名、组好卡组后，点「生成桌游数据」→ 页面组装完整桌游包（meta + assets + 无座 initialState，`buildGameFromDecks` 摊平卡组）→ **页面上展示完整 json 文本 + 控制台打印**，供上传前检查；确认无误后再点「上传桌游」（S4b）。参数/卡组变更后可重新生成（重新生成会更新 id）。

**改**：
- `lib/pnp/crop.ts`：
  - 新增 `Deck` 类型：`{ cards: { frontSpriteId: string; backSpriteId: string }[] }`（`backSpriteId` 空串 = 默认卡背）
  - 新增纯函数 `buildGameFromDecks(decks: Deck[], sprites: Sprite[]) → { prefabs, entities, piles }`：
    - prefabs：每卡一个，id `prefab-{n}` 连续；`faces = { front: frontSpriteId, back: backSpriteId }`
    - entities：id `inst-{n}` 连续；`prefabId` 对应；`faceUp: false`；坐标字段存在且为 0（`x: 0, y: 0, zIndex: 0`）
    - piles：每卡组一个，id `pile-{ts}`；`entityIds` 按卡组内顺序；坐标字段存在且为 0（`x: 0, y: 0`）
  - 删除旧 `buildPnpAssetsMulti` / `PagePairData` / `BuildPnpMultiParams`（镜像 `mirrorBackIndex` 保留，S5 页对预设用）
- `app/(main)/import/page.tsx`：
  - 加回**游戏名输入框**（参数区，默认文件名去 .pdf）
  - 新增状态 `pendingUpload: { meta, assets, initialState } | null`
  - 新增「生成桌游数据」按钮：`handleGenerate`——sprites = 图片池全量；`{ prefabs, entities, piles } = buildGameFromDecks(decks, sprites)`；`initialState = { entities, piles, seats: [] }`；`meta = { id: "pnp-"+Date.now(), name, icon: "🖼️" }` → 存 `pendingUpload` → 页面 JSON 展示区（等宽字体、可滚动）显示完整 json + `console.log("generated:", payload)`（url 截断）
  - 按钮禁用条件：无文件 / 无切图 / 游戏名为空 / 生成中

**验收**：
- 点「生成桌游数据」→ 页面 json 区与控制台显示完整 payload：meta（id `pnp-{ts}`）+ assets（sprites 全量、prefabs 引用正确）+ initialState（`seats: []`、piles 每卡组一个、**entities 与 piles 坐标字段均为 0**）
- 0 个卡组也能生成（纯资源库：prefabs/piles 空）
- 改名 / 改卡组后重新生成 → json 更新（新 id）

---

### S4b：Lab 沙盒调整初始布局

**能力（改完后）**：生成 json 后，点「进入 Lab 调整」→ 页面切换为**全屏沙盒**（复用 GameBoard 受控模式，无座，不涉及任何服务端）→ 拖拽自由移动卡牌与牌堆、翻面/洗牌/抓手牌（沙盒语义，随意玩）→ 点「保存并返回」→ 把调整后的 entities/piles 坐标写回 initialState（seats 保持 `[]`）→ 回导入页，json 区显示更新后的坐标 → 可再次进 Lab 继续调。

**改**：`app/(main)/import/page.tsx`：
- 新增视图切换状态 `view: "import" | "lab"`；lab 视图全屏渲染（`h-screen`，参考游戏页布局）
- lab 视图：`<GameBoard gameState={labState} onAction={(a) => setLabState(prev => applyAction(prev, a))} />`（复用引擎 `applyAction`，本地状态）；顶部悬浮栏：标题「Lab — 调整初始布局」+ 「保存并返回」按钮
- 进 lab：`setLabState(pendingUpload.initialState)`；保存返回：`initialState = { ...labState, seats: [] }` 写回 `pendingUpload` → 回 import 视图
- 生成新 json 或重新生成后，lab 状态随之重置（以最新 pendingUpload 为准）

**验收**：
- 点「进入 Lab 调整」→ 全屏沙盒，牌堆/卡牌按 json 坐标显示
- 拖拽移动卡牌与牌堆、翻面等交互正常（复用 GameBoard 能力）
- 点「保存并返回」→ 导入页 json 区坐标已更新为拖拽后的值；`seats` 仍为 `[]`
- 再次进入 Lab → 显示上次保存的布局；上传前可反复调整

---

### S4c：上传桌游 json

**能力（改完后）**：生成并检查无误后，点「上传桌游」→ 把 `pendingUpload` 发送给 WS 服务端 → 落盘 `server/data/games/<id>.json` → 自动跳转游戏广场并刷新列表。

**改**：
- `lib/multiplayer/protocol.ts`：`ClientMessage.upload_game` 增加 `initialState: GameState`
- `server/game-library.ts`：`SavedGame` 增加 `initialState: GameState`；`loadAll` 校验缺失 initialState 的文件跳过并 warn（旧 json 不再加载，文件保留）
- `server/handlers.ts`：`upload_game` 分支把 `parsed.initialState` 一并存入 SavedGame
- `app/(main)/import/page.tsx`：
  - 新增「上传桌游」按钮（`pendingUpload` 为 null 时禁用）：`send({ type: "upload_game", ...pendingUpload })`
  - 监听 `game_uploaded` → 跳转 `/games`（列表自动刷新）；监听 `error` → 提示上传失败
**验收**：
- 点上传 → `server/data/games/<id>.json` 落盘，结构与生成的 json 一致（含 Lab 调整后的坐标）
- 重启 WS 服务端 → 日志旧 json 显示 skip；广场列表只显示新游戏（旧游戏不加载）
- 上传成功自动跳转 /games，列表出现新游戏

---

### S5：页对预设快捷按钮（控制台打印生成的 decks json）

**改**：`app/(main)/import/page.tsx` 新增「自动正反交替组卡」按钮：勾选页按 (1,2),(3,4) 配对，每对生成一个卡组（正面 = 奇数页切图、背面 = 偶数页镜像图，用 `mirrorBackIndex`），与手动卡组共用同一上传路径

**验收**：4 页 PDF 全选 → 一键生成 2 个卡组，卡组面板可见，背面为镜像图；控制台打印的 decks json 背面引用正确（第 i 行 j 列 ↔ 第 i 行 cols-1-j 列）

---

### S6：消费端直接使用 initialState（删除 buildGame，不重算坐标）

**能力（改完后）**：试玩 / 创建房间 / 加入房间 / 重新开始全部直接使用服务端下发的 initialState（坐标 0 原样显示，不做居中）；`buildGame` 从代码库消失。

**改**：
- `lib/multiplayer/protocol.ts`：
  - `game_data` 增加 `initialState: GameState`（无座存档版）
  - `room_created` 增加 `initialState`（无座存档版，供重新开始用）与 `gameState`（服务端补座后的初始状态，供显示）
  - `room_joined` 不变（已带 gameState）
- `server/room-manager.ts`：`createRoom` 改为 `gameState = { ...structuredClone(initialState), seats: [createSeat()] }`（防多房间共享引用 + 创建者可落座）
- `server/handlers.ts`：`create_room` 下发 `initialState` + `gameState`（补座版深拷贝）；`get_game` 下发 `initialState`
- `app/(main)/games/page.tsx`：`room_created` 分支直接用 `msg.gameState` 存 session 并跳转（**删除 buildGame 与 update_game_state**）
- `app/(game)/game/[gameId]/play/page.tsx`：`game_data` 分支用 `msg.initialState` 直接作初始状态（无座，GameBoard 自动补虚拟座位）；重新开始 = 直接回 initialState；删除 `buildGame` 引用
- `app/(game)/room/[code]/page.tsx`：进房存 initialState 到 ref（session 取）；删除竞态兜底逻辑（服务端 gameState 恒非空）；房主重新开始 = `{ ...initialState, seats: 当前 seats 保留实例+归属、仅清空 handZone.entityIds }` → `update_game_state` 广播
- 删除 `lib/engine/build-game.ts`（buildGame 无调用方）

**验收**：
- 试玩：进页即见牌堆在桌面原点（坐标 0 原样），无座自动补虚拟座位可抓牌；ESC 重新开始回 initialState
- 开房：创建者进房有一个默认空座可占，牌堆在桌面原点；加入者经 state_sync 一致
- 重新开始：座位实例与归属全保留、手牌清空、牌堆回 initialState
- `grep -r "buildGame" app/ lib/` 无结果；`tsc --noEmit` 通过
- 旧数据游戏从广场消失（服务端不加载）

---

### S7：清理

**改**：移除验收用 console.log（sprites/decks/upload 打印）；更新 `docs/architecture.md`"初始状态构建"条目（buildGame 客户端执行 → 导入固化无座 initialState 坐标 0）；新增 `docs/notes/implemented.md` 条目；删除本临时文件

**验收**：`tsc --noEmit` 通过；文档已更新；`docs/TEMP-import-rework.md` 已删除；`grep -r "buildGame" app/ lib/ server/` 无结果

## 关联

- **依赖**：a4e8654 三层模型重构（已完成）
- **被依赖**：ROADMAP「桌游实体扩充」（本次导入只产卡牌，实体类型扩展留待该需求）
- **文档**：完成后更新 `docs/architecture.md`"初始状态构建"条目 + 新增 implemented note

## 边界（本次不做）

- 卡组命名（牌堆 id 自动 `pile-{ts}`）；每页独立切割参数；导入页内牌堆自由摆放；旧 json 迁移/删除
