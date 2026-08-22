# 临时需求文档：Import → Lab 重构（多 PDF 组装工作台）

> **临时文档**：重构完成后删除或并入 `docs/notes/implemented.md`。
> 目标：导入页从"导入为主、Lab 收尾"翻转为"**Lab 为主体**，可反复通过弹窗导入多个 PDF 实体，整体组装为一个桌游"。
> 切片拆分标准：**以模块化修改为组**，一步同时改动两个以上模块就拆开。
> 切片总览：1a 路由改名 → 1b lab 主体+抽 ImportFlow → 2 弹窗化 → 3a lib 参数化 → 3b 提交链路 → 4 保存打印 → 5 indexDB 草稿 → 6 上传 → 7a Lab 删除 → 7b Lab 复制。

## 最终形态（本次重构完成后的样子）

- 路由 `/lab` = 桌游组装工作台：全屏沙盒（GameBoard 受控、无座）+ 浮动控件（导入 PDF / 保存 / 上传 / 返回）
- 点 [导入 PDF] → 弹窗呼出 ImportFlow（**原样复用现有四段流程**，不做分步改造）：选 PDF → 页勾选/切割参数/预览 → 实体定义+图片池 → 实体组 → 点 [导入] 提交
- 提交后弹窗关闭，该批次实体以网格空位出现在 lab 桌面，可拖摆；**可反复导入多个 PDF**
- [保存] → 完整桌游数据（meta + assets + initialState）写入 indexDB 草稿；进入页面自动恢复；[上传] → 调原上传链路，成功后清草稿跳广场
- Lab 内 hover 实体 Delete 删除 / Ctrl+D 复制：**后续切片**（本期不做）

---

## 切片 1a：路由改名 /import → /lab + 入口更新

- **做什么**：
  - `app/(main)/import/page.tsx` → `app/(main)/lab/page.tsx`（git mv，内容暂不动）
  - `app/(main)/games/page.tsx`：`router.push("/import")` → `router.push("/lab")`；入口文案「导入 PDF 桌游」→「新建桌游」
- **验收标准**：访问 `/lab` 打开原导入页；`/import` 404；广场卡片指向 `/lab` 且文案为「新建桌游」
- **关联**：无前置；被 1b 依赖

## 切片 1b：页面重构为 lab 主体 + 抽出 ImportFlow

- **做什么**：
  - 新建 `components/import/ImportFlow.tsx`：原 page 的四段流程 + 全部面板内状态（file/pageCount/rows/cols/crop/selectedPages/previews/sprites/groups/shapes/sizes/picker 等 + localStorage 切割参数恢复）**原样搬入**；内部保留旧"生成"逻辑（数据 console 呈现，不上桌——上桌是 3b）
  - `app/(main)/lab/page.tsx` 重构为默认 lab 主视图：`h-screen` + GameBoard 受控渲染空态 `{ entities: [], piles: [], seats: [] }` + 空态提示文案
  - [导入 PDF] 按钮（浮动控件）点击 → `showImport = true` **整页切换**显示 ImportFlow（非弹窗，弹窗是切片 2）；ImportFlow 内 [返回] → `showImport = false` 回 lab
- **验收标准**：进入 `/lab` 默认显示 lab 空桌 + 空态提示；点 [导入 PDF] → 整页切换进 ImportFlow，完整走通旧流程（选 PDF → 切割 → 实体定义 → 实体组 → 生成，生成数据 console 打印）；点 [返回] 回到 lab 空桌；原有页面行为不回归
- **关联**：前置 1a；被 2 依赖

## 切片 2：ImportFlow 弹窗化

- **做什么**：
  - `app/(main)/lab/page.tsx`：增加 `importOpen` 状态；[导入 PDF] 按钮启用
  - ImportFlow 包弹窗容器（居中大弹窗 + 遮罩 + [取消]），新增 props `onClose`
  - ImportFlow 底部改为 [取消][导入]；[导入] 暂 console.log 待提交数据 + 调 onClose（lab 桌面暂无新实体——3b 实现）
- **验收标准**：点 [导入 PDF] 弹窗打开（遮罩 + 居中弹窗，四周露出 lab 桌面）；[取消] 关闭；[导入] 关闭并在控制台打印待提交数据（sprites 数 + 组数）
- **关联**：前置 1b；被 3b 依赖

## 切片 3a：buildGameFromGroups 参数化（纯 lib）

- **做什么**：`lib/pnp/crop.ts` `buildGameFromGroups(groups, sizes?, startIndex? = 0)`
  - prefab/inst id：`prefab-{startIndex+n}` / `inst-{startIndex+n}`
  - pile id：`pile-{startIndex+gi}`（替代现有 `pile-{ts+gi}`，opaque 无依赖）
- **验收标准**：缺省调用输出与现状逐字段一致（回归）；传 `startIndex` 后 id 从该值连续递增；pile id 不再含 ts
- **关联**：无前置；被 3b 依赖

## 切片 3b：提交链路（弹窗 → lab 桌面）

- **做什么**：
  - `app/(main)/lab/page.tsx` 增加工作区状态：`sprites: Sprite[]` / `prefabs: Prefab[]` / `labState: GameState`（seats 恒空）+ 全局计数器 refs（sprite/entity/pile，页面存活期不重置）
  - ImportFlow props 增加 `onCommit(payload: { sprites, groups, sizes, fileName })`；[导入] 调 onCommit 替代旧生成
  - 页面 commit：`buildGameFromGroups(groups, sizes, entityN0, pileN0)` → sprites/prefabs 追加、entities/piles 合并入 labState；新牌堆按**确定性网格空位**摆位（如 `40 + (col%5)*300, 40 + floor(col/5)*320`，col 按已有牌堆数递增），避免叠在旧实体上
- **验收标准**：弹窗完成流程点 [导入] → 弹窗关、该批次实体以网格位出现在 lab 桌面、可拖摆；再导入第二个 PDF → 旧实体位置不变、新实体网格位加入；两批次 sprite/prefab/inst/pile id 无重复
- **关联**：前置 2 + 3a；被 4/5/6 依赖

## 切片 4：保存按钮 + 控制台打印

- **做什么**：`app/(main)/lab/page.tsx` 底部浮动区 [保存] 按钮；点击组装完整数据 `{ meta: { id: "pnp-{Date.now()}", name, icon: "🖼️" }, assets: { sprites, prefabs }, initialState: labState }` 并 `console.log`（打印 sprites url 截断摘要 + prefabs + initialState）
- **验收标准**：点 [保存] 控制台打印完整桌游 JSON（含全部实体坐标）；重复点击每次打印一致
- **关联**：前置 3b；被 5 依赖

## 切片 5：保存到 indexDB + 自动恢复 + 丢弃

- **做什么**：
  - 新建 `lib/storage/draft.ts`（无第三方依赖）：indexDB `bob-draft` 库单槽位，`saveDraft(draft)` / `loadDraft()` / `clearDraft()`，约 70 行
  - `app/(main)/lab/page.tsx`：[保存] 调 `saveDraft`（把打印换成真实写入）；进入页面 `loadDraft` 自动恢复（name/sprites/prefabs/labState + id 计数器按现有 id 最大序号 +1 续）；恢复时右上角 chip「草稿已恢复 · 丢弃」→ `clearDraft` + 重置工作区
- **验收标准**：导入 + 拖摆后点 [保存]；刷新页面 → 自动恢复全部（名称、实体、坐标、后续导入 id 不碰撞）；点丢弃 → 清空回空桌，再刷新无草稿
- **关联**：前置 4；被 6 依赖

## 切片 6：上传按钮

- **做什么**：`app/(main)/lab/page.tsx` [上传] 按钮启用：组装 `{ meta, assets, initialState }`（initialState 强制 `seats: []`）→ `send({ type: "upload_game", ... })`；沿用原消息处理（`game_uploaded` 匹配 gameId → `clearDraft` + 跳 `/games`；error → 可重试）
- **验收标准**：点上传 → 跳转广场，列表出现该桌游；[试玩] initialState 坐标 = lab 布局；草稿已清（再进 /lab 为空桌）
- **关联**：前置 5

## 切片 7a：Lab 内删除（hover + Delete）

- **做什么**：
  - `lib/engine/actions.ts`：导出 `removeEntity(state, id)` 纯函数（复用 `removeCard` 内部逻辑：从 piles/handZones 移除 + 剩余 ≤1 张解散堆）；**不进协议/动作注册表**，Lab 本地调用
  - `components/game/card-action/CardActionProvider.tsx`：可选 props `onDelete`/`onCopy`（ref 模式，同现有 onFlip/onDraw）；Delete 键 → `onDelete(activeId)`
  - `components/game/GameBoard.tsx`：可选 `labMode` prop，labMode 时把 `onDelete` 传给 CardActionProvider 并上抛
  - `app/(main)/lab/page.tsx`：`handleDelete(id)` = `setLabState(prev => removeEntity(prev, id))`；删除为纯内存操作，不触发自动保存（保存靠手动按钮）
- **验收标准**：lab 中 hover 实体按 Delete → 实体消失；堆内牌删除后剩余 ≤1 张自动散堆（剩余牌恢复自由坐标）；play/room 页面不传 labMode → 键位行为不变；操作不发送任何协议消息
- **关联**：前置 3b（工作区状态）；为 7b 搭好基础设施

## 切片 7b：Lab 内复制（hover + Ctrl+D）

- **做什么**：
  - `components/game/card-action/CardActionProvider.tsx`：Ctrl+D 键 → `onCopy(activeId)`（7a 已留 props 框架）
  - `components/game/GameBoard.tsx`：labMode 时透传 `onCopy`
  - `app/(main)/lab/page.tsx`：`handleCopy(id)` = 找到实体 → 克隆新实例（新 id 由 `entityCounterRef` 续）→ `x+24, y+24`、zIndex 置顶 → 自由实体（不入堆）；堆内牌复制为单张自由牌，不复制整堆
- **验收标准**：hover 实体按 Ctrl+D → 副本出现在原实体右下偏移 (24,24)、zIndex 置顶、id 不冲突；连续多次复制 id 递增不重复
- **关联**：前置 7a

---

## 本期明确不做（后续切片）

- **弹窗分步化**：用户已否决，ImportFlow 原样复用
- **自动保存 / 未保存状态提示**：用户明确不要，纯手动 [保存]
- **对局内删除实体**：需要协议动作，另行评估
- **复制整堆**：当前复制单张自由牌，整堆复制留待需求出现
