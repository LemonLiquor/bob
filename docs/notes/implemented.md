# implemented — 已落地的决策

> 记录决定了什么 + 否决了什么，**与代码保持同步**（代码改名/移动时同步更新事实）。
> 单文件多条目，小项目不建目录；条目按日期倒序。

## Token 实体：可变尺寸 + 单面 + 圆形取图 + 分批导入工作流

- **日期**：2026-08-21（首次提出）
- **主题**：实体从"只有卡牌（120×168 矩形）"扩展为可变尺寸/形状，支持小型板块与圆形筹码等常见桌游组件

**决定了什么**：

- **尺寸**：`Prefab.size?: { width, height }`（缺省 120×168 = 卡牌，旧数据零迁移）；构建时复制到 `EntityState.size`（物理属性，随 state_sync 传输）；渲染（Card 容器 / Pile 容器）与重叠判定（`findOverlap` 阈值 = 目标短边/2，上限 30）按尺寸
- **不同尺寸不可堆叠**：`placeAt` 入堆/建堆前 `sameSize` 校验（缺省 120×168 归一比较，旧数据兼容）；尺寸不同 → 自由放置可重叠
- **单面实体**：`Prefab.singleFace` + 复制到实例；引擎 `flipCard` 直接忽略（状态不变不广播）+ 客户端发送前拦截；渲染显式 `showFront = faceUp || singleFace`
- **形状在取图时定**：实体定义面板（页面预览与图片池之间）圆形遮罩 `toCircular` 生成透明 PNG，无 shape 字段/渲染分支；`singleFace` 时 `back` 置空不重复引用
- **分批导入工作流**：追加式切割（sprite id 全局计数器永不重用）；实体定义只显示最近一次切割（自动全选），`sprites` 全量累积（实体组引用保留）；图片池 = 实体定义选中集；切割参数存 localStorage（进入恢复、切割时更新）；实体组可折叠
- **实体组**：Deck 概念更名 EntityGroup（含 `singleFace` 组级标记），背面在新建时三选一（选图/正反面一样/默认卡背），单面组背面固定不可改
- **修复**：替换正/背面字段映射（`[face]` 计算属性 → `frontSpriteId/backSpriteId` 映射）

**否决了什么**：

- `shape` 字段/渲染层形状分支：圆形靠透明 PNG，多边形/不规则靠素材自带
- `stackLayout` 尺寸缩放：偏移 0.5px 亚像素级无意义
- 骰子等多面实体（faces 数组化 + faceIndex）：大重构，留待后续需求
- 3D 拟真堆叠（z 轴/等距投影）：现有层叠够用
- 碰撞盒形状化（hex 精确判定）：版图设计为不可叠放进 ROADMAP

## 导入页重构：资源工厂 + 卡组组装 + Lab 布局 + 无座 initialState 固化

- **日期**：2026-08-21（首次提出）
- **主题**：导入流程从"自动批量生成卡牌"重构为"PDF → 图片池 → 手动卡组组装 → Lab 摆布局 → 上传（meta + assets + 无座 initialState）"，初始状态固化取代运行时派生

**决定了什么**：

- **导入四段流程**：页面多选 + 全局切割参数 → 切图图片池（sprite id `sprite-{n}` 全局连续）→ 卡组组装（页面内临时结构 `Deck`，一卡组 = 一个 Pile；共用背面 = prefab 共享 sprite，消除每卡独立背面冗余）→ 生成桌游（`buildGameFromDecks` 摊平为 prefabs / entities / piles，坐标全 0）→ Lab 全屏沙盒（复用 GameBoard 受控模式 + `applyAction` 本地状态）拖摆坐标 → 「保存并上传」
- **初始状态固化**：上传内容 = meta + assets + `initialState`（`seats: []` 无座）；坐标由 Lab 自定义，运行时**不重算**（不做居中）；`buildGame` 删除
- **消费端直接用 initialState**：试玩（`game_data`）/ 创建房间（`room_created` 带 `initialState` + 补座版 `gameState`）/ 加入与重连（`room_joined`）/ 重新开始（房主 `update_game_state`，回 initialState + 座位保留实例与归属、仅清空手牌）
- **座位是运行时概念**：存档无座；`createRoom` 补 1 个默认空座（复用 `createSeat`）保证创建者可落座，加入者由 `joinRoom` 现有逻辑自动补座
- **旧数据不兼容**：`SavedGame` 增加 `initialState`，`loadAll` 常规格式校验（缺 assets.sprites 或 initialState 跳过），旧 json 不再加载（文件保留）
- **上传链路**：`upload_game` 携带 `initialState`；上传成功跳转广场；Lab 内失败提示可重试

**否决了什么**：

- 运行时居中方案（`recenterInitialState` 多牌堆整体居中）：坐标改为 Lab 固化，创建房间/试玩直接读 json
- 座位进存档：无座（重新开始若清空座位会导致玩家无法落座，需冗余补座函数）
- 旧数据迁移/兼容：不兼容，重新导入
- 导入页 icon 自定义、卡组命名、每页独立切割参数：留待后续

## UI 几何风格主题（模块化体系 + 明暗切换）

- **日期**：2026-08-18（首次提出）
- **主题**：全站 UI 换装为几何风格（红黄蓝三原色 + 黑描边 + 硬阴影），并建立模块化样式体系

**决定了什么**：

- **视觉来源**：`docs/references/BauHaus.html`（参考范例，2026-08 收集），完整风格落地，未做克制删减
- **模块化两级体系**（核心决策，解决"小范围修改涉及太多代码"）：
  1. **token 变量**：`app/globals.css` `:root` + `[data-theme="dark"]` 两套（红 `#E63946` / 黄 `#F4D35E` / 蓝 `#457B9D` / 黑 `#1D1D1D` / 米白 `#F1FAEE`；阴影 4/8/12px 三档）
  2. **组件类**：`@layer components` 11 个（`btn-pop` / `btn-ghost` / `link-pop` / `card-pop` / `panel-pop` / `nav-shell` / `logo-shape` / `input-pop` / `dashed-zone` / `tag-pop` / `status-dot`）
- **后续小范围改风格 = 只动 globals.css 对应位置**，组件文件不散落视觉细节
- **明暗切换**：`components/layout/ThemeSwitch.tsx`（导航黄色方块），`documentElement.dataset.theme` + `localStorage["bg_theme"]`，render 期间 setState 模式恢复（无 lint 问题）
- **几何背景**：`components/layout/GeoBg.tsx` 固定层（圆/方/三角，明 0.06 / 暗 0.03 透明度）
- **字体**：Space Grotesk 经 `next/font` 自托管（离线可用），中文回退系统字体

**边界**：

- **卡牌本体是内容**：用户上传的 PDF 卡面/卡背（`Card.tsx` faceClass）不套 UI 样式
- **语义色保留**：绿色=加入/可操作、红色=错误/危险、黄色=等待，两套主题下不变
- **桌布**（`bg-desk`）跟随主题（明米白 / 暗黑）

**否决了什么**：

- 克制版（缩小阴影/淡几何背景）：用户明确选择完整风格，不删减
- 单页试点流程：用户明确选择直接全站
- 品牌风格（曾两次尝试并回退，见 rejected.md 历史记录；避免提及品牌）
