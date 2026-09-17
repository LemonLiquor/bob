# implemented — 已落地的决策

> 记录决定了什么 + 否决了什么，**与代码保持同步**（代码改名/移动时同步更新事实）。
> 单文件多条目，小项目不建目录；条目按日期倒序。

## 资产清洗：创建桌游最后一步删除不可达 prefab / sprite

- **日期**：2026-09-17（首次提出）
- **主题**：PDF 导入未选用图片、删实体后的孤儿 prefab 长期堆积（存量最大单文件 60 MB，清理后 9.8 MB），新增资产清洗能力

**决定了什么**：

- **纯函数 `pruneUnusedAssets(assets, entities)`**（`lib/engine/prune-assets.ts`，engine 导出）：判定与运行时引用链一致——prefab 被 `initialState.entities[].prefabId` 引用才保留；sprite 被保留 prefab 的 `faces` 引用才保留。不重编号 id、保持数组原顺序、不修改入参
- **调用点 = 创建桌游最后一步**：`server/game-library.ts saveGame()` 写入/入内存前清洗（唯一持久化入口，服务端纵深防御；日志输出 pruned 数量）
- **悬空引用不处理**：entity→缺失 prefab / prefab→缺失 sprite 只影响渲染回退，不删实体、不改引用
- **存量清理用临时脚本 `scripts/clean-assets.mjs`**：默认 dry-run，`--write` 先备份到 `server/data/backup-<ts>/` 再原地写回；已对 4 个桌游执行（sprites -1890 / prefabs -155，`server/data/games` 76 MB→19 MB）。**脚本不随产品维护**，产品能力以 `pruneUnusedAssets` 为准

**否决了什么**：

- **客户端 Lab 上传前清洗**：服务端 saveGame 已兜底（唯一持久化入口），避免双点维护；上传 payload 体积优化另立需求
- **sprite 去重**（同 URL 多份，存量约 800 组，需重映射 faces 引用）：独立能力，先不做
- **loadAll 时清洗**：加载路径不做写操作，存量已由临时脚本清过

## 版图跟随（相对坐标 + DOM 层级）：移动版图零引擎联动

- **日期**：2026-08-23（首次提出）
- **主题**：实体跟随版图移动（README TODO 完成）。**坐标语义改为相对坐标**：`parentId` 非空 → x/y 相对父版图容器；空 → 世界坐标。移动版图只改版图自身坐标，子实体坐标不动，渲染 DOM 层级天然跟随——**引擎无移动联动逻辑**（无 board 分支、无 delta 平移）

**决定了什么**：

- **坐标语义**：`EntityState.x/y` + `Pile.x/y` 在 parentId 非空时 = 相对父版图坐标；parentId 空 = 世界坐标（桌面坐标系）。`worldOf(state, e)` 沿 parentId 链上溯求和（环保护）
- **归属写时机**（唯一引擎逻辑）：`placeAt` 落点（世界坐标）中心在版图世界矩形内（`findBoardAt`）→ 写 parentId + **坐标换算相对**；未命中 → 清 + 保持世界坐标；建堆继承落点归属（换算）；`movePile` 落点重判（换算）；`rotateEntity` 旋转后重判（脱离者换算回世界）；`removeEntity` 删版图子实体换算回世界；入堆/入手牌/掉牌清归属（坐标由下次 placeAt 重设）
- **渲染层级**：`BoardContainer` 递归——版图 droppable（悬停高亮）+ 容器 + **跟随层**（版图拖动时与 Card 的 dnd transform 同步，子实体 DOM 父子跟随）+ 子实体（x/y 直接定位）+ 子堆 + 嵌套版图递归；拖拽中 `boardLifted` 容器置顶（不迁移 DOM，防卸载重挂）
- **Pile 永不解散**（剩 1 张也保留：堆位置/归属承载剩余牌，防相对坐标错位）；**move 动作末尾 `pruneEmptyPiles` 清理空堆**（moveCard / moveCardToHand / moveCardToPile / removeEntity；空堆清理后放回原位置 = 自由放置，不重建）
- **Pile 容器层级 = 堆内最高实体 z**：堆在版图上不被版图图面盖住
- **兜底**：`assignParents` 幂等（GameBoard 非受控初始化 / 服务端 createRoom / Lab 导入草稿）——**跳过堆内实体与版图自身**（批量判定会互相包含成环，嵌套版图归属靠运行时放置写入）
- **UI 位移状态**：`dragDelta`（onDragMove 累计，dragEnd/dragCancel 清零）

**否决了什么**：

- **引擎移动联动**（moveCard board 分支 + boardFollowers + delta 平移）：相对坐标下子实体无需联动，整套删除
- **世界坐标 + 渲染换算**（left = 世界 - 版图）：换算散落渲染层，弹回风险
- **物理引擎 / DOM 迁移拖拽中重组**：容器置顶替代
- **旋转带动实体**：本次只做移动；卡牌旋转渲染留待 TODO"卡牌可以横着放"

## 手绘弹窗面板化：功能区固定槽位，画布定位稳定

- **日期**：2026-08-23（首次提出）
- **主题**：贴纸面板出现/消失顶动画布导致绘制定位漂移，弹窗改固定面板布局

**决定了什么**：

- **弹窗 = 固定高度面板**：`flex flex-col max-h-[92vh] overflow-hidden`；标题/kind/尺寸/画布（320px）/工具行/按钮行全部 `shrink-0`，位置恒定
- **功能区槽位**：`flex-1 min-h-0 overflow-y-auto` 固定占位（贴纸面板 / 放置条共用），内容多时内部滚动；弹窗高度不变 → 画布永不被顶动
- **贴纸面板常驻**：不再条件渲染（移除 emojiOpen 状态与工具行「贴纸」按钮）；未来「切换收起」= 槽位高度归零，画布/工具行不动（结构已就绪，本次不做）
- **弹窗改左右分栏**（纵向堆叠改横向）：头部 = 标题 + 取消/完成；左列（shrink-0）= kind / 尺寸 / 画布；右列（flex-1）= 工具行 + 功能区槽位；弹窗加宽至 max-w-3xl
- **预制 emoji 移除 → 导入历史**：会话内最近 12 条（去重、新在前），emoji 存字符、图片存 dataURL（FileReader，不依赖 objectURL 生命周期）；点击历史直接进入放置模式；空历史有提示

**否决了什么**：

- **弹窗高度随内容自适应**：画布位置漂移的根源，改为固定高度面板

## ESC 菜单弹窗：不点遮罩关闭（防绘制/选择误触）

- **日期**：2026-08-23（首次提出）
- **主题**：ESC 菜单呼出的弹窗移除点击遮罩关闭，只走弹窗内「取消」按钮

**决定了什么**：

- **DrawEntityModal / ImportGameModal 移除遮罩 onClick**；ImportGameModal 列表态补齐「取消」按钮（原来只有遮罩可关）
- **范围**：ESC 菜单呼出的弹窗（导入 PDF ImportFlow / 导入桌游 / 手绘实体 / 上传确认）全部只走按钮关闭；上传确认与 ImportFlow 本就无遮罩关闭

**否决了什么**：

- **遮罩关闭保留**：绘制/选择时点偏即误关，得不偿失

## Lab 手绘实体：画布透明背景 + 分辨率 = 尺寸 × 2，形状零新字段

- **日期**：2026-08-23（首次提出）
- **主题**：lab 支持手绘实体（ESC 菜单入口），画完直接上桌

**决定了什么**：

- **形状零新字段**：画布透明背景导出透明 PNG，复用"形状在取图时定"机制（渲染层矩形 + 透明图，无 shape 字段）；不需要 toCircular
- **像素分辨率 = 导出尺寸 × 4**：几何锯齿控制；dataURL 体积可控（assets 进房一次性下发）
- **笔粗 = 视觉 px × SCALE**：档位 [1,2,4] 是桌面像素，画布实际 4/8/16（恒整数，避免非整数线宽的 AA 不对称）；1px 线有 4 画布像素实心支撑，缩放后不发虚（线条发虚根因 = 笔画 AA + 导出缩放双重抗锯齿）
- **填色补齐 AA 边缘**：flood fill 匹配条件加 alpha ≤ 96 视为空白——笔画半透明边缘被填充色覆盖（alpha 拉满 255），填色后无缝不残留；笔画实心（alpha 255）不受影响
- **尺寸输入比例锁定**：宽/高数字框（默认按 kind：卡牌 120×168 / token 80×80 / 版图 240×240），改宽则高按当前比例跟随；画布重建时旧内容 drawImage 等比缩放保留（不变形不丢笔迹）；kind 切换则清空
- **kind 三 tab**：card 背面空串 = 默认卡背；token 单面可叠；board 可旋转（方形画布与"碰撞盒用未旋转尺寸"无冲突）
- **上桌**：sprite + prefab + 实例（网格空位摆位同 ImportFlow，z 置顶 maxZ+1）；card faceUp 默认 false（同 buildGameFromGroups）
- **工具行**：6 色（Bauhaus 色板）/ 3 档笔粗 / 橡皮（destination-out）/ 填色（自实现扫描线 flood fill：栈式 4-邻域 + visited 去重，容差 32 匹配 RGBA 抗锯齿边缘，实际修改像素才压栈）/ 贴纸（emoji，见下）/ 撤销（ImageData 栈 20 步，清空可撤销）/ 清空；绘制 pointerdown + window move/up（拖出画布不断线）；橡皮与填色互斥
- **内容源统一（stampToCanvas）**：所有内容源（手绘/emoji/图片）渲染进同一张画布位图，自动获得全部工具链（撤销/橡皮/填色/导出），零分支；`stampToCanvas(render)` = 压栈（渲染前）+ 以画布中心为锚执行渲染
- **贴纸面板 = 统一内容源入口**：① emoji/文字输入框（全量 = 输入即所得，回车渲染，不内置字符表、不引依赖）② 精选 grid（30 个快捷）③ 大小滑块 stickerScale 0.1~0.9（emoji 字号与图片缩放共用 = 画布 min 边 × scale）④ 导入本地图片（file input → objectURL → Image → drawImage，长边对齐 target 等比缩放）
- **放置模式（贴纸可调位置/大小/预览）**：选贴纸 → 半透明虚线预览层（DOM 叠加在画布容器上，不碰主画布像素 → 撤销栈干净）→ 拖动调位置（window move/up，CSS 位移 ×SCALE 换算画布像素）→ 滑块/滚轮调大小（保持宽高比，中心锚定；滚轮原生监听 passive:false，上下限 8px~2×min 边）→ [放置] 一次性固化（一个撤销步）/ [取消] 或 ESC 放弃；放置期间锁绘制（预览层挡中心，画布边缘 onDown 拦截）；`stampToCanvas` 签名升级为矩形锚点 (rect, render)，emoji fillText / 图片 drawImage 同构
- **在线图片扩展点**：复用文本输入框（URL → Image 加载，需 CORS 处理防 canvas 污染），本次不做
- **画布像素 ↔ CSS 显示换算（cssK）**：预览层/拖动用 `cssK = SCALE × size.height / DISPLAY_H`（画布像素 × cssK = CSS px），**不能用 1/SCALE**——显示尺寸（DISPLAY_H=320）与分辨率（size×SCALE）独立；曾误用 ÷SCALE 导致预览只有实际 1/4、拖动 ×SCALE 放大 4 倍飞出去、拖飞后放置内容在画布外
- **预览与绘制位置对齐**：canvas 的 border 移到画布容器（canvas 无 border）——border-box 下 canvas 内容区缩进 border 宽度，预览坐标相对容器原点会整体偏移 border px；图片 objectURL 延迟到放置/取消后才 revoke（预览 `<img>` 依赖它）
- **预览 = 渲染同一绘制代码**：emoji div/img 预览与 canvas 渲染是两套代码，emoji 字体基线行为不同导致垂直偏移；改为预览层 = 外层虚线框（outline 不占盒空间）+ 内层 canvas，重绘 effect 用与 confirmPlace 完全相同的 fillText/drawImage 参数 → 预览即渲染的精确预览，零偏移
- **放置模式 clamp**：拖动限制贴纸中心在画布内（防拖飞后放置不可见）；kind 切换画布重建时取消未放置的贴纸

**否决了什么**：

- **形状/大小字段进引擎**：手绘形状由像素承载、尺寸复用现有 Size，引擎与协议零改动
- **图层 / 重做（redo）**：当前不需要的抽象

## Lab 导入现有桌游：复用 get_game 链路，上传永远保存为新桌游（不允许覆盖）

- **日期**：2026-08-23（首次提出；同日修订：覆盖语义 → 新建语义）
- **主题**：lab 支持直接导入桌游库中的现有桌游，在其基础上修改后**上传为新桌游**（曾为幂等覆盖，误覆盖造成数据丢失后修订）

**决定了什么**：

- **零服务端/协议改动**（导入链路）：复用 `get_game` → `game_data`（assets + 无座 initialState）
- **入口**：ESC 菜单新增"导入桌游"按钮 → `ImportGameModal`（新组件：`list_games` 列表 + 两段确认"替换当前工作区"）
- **导入 = 整体替换工作区**：`setName` + sprites/prefabs/labState 替换 + `setAssets`（同步先于渲染）+ 计数器 `nextSeq` 重置（防后续 id 碰撞）；`clearDraft` + `setRestored(false)`（旧草稿废弃）
- **上传永不覆盖**：导入时 **`gameIdRef` 不沿用原 id**（保持 null）→ 上传/保存草稿时生成新 `pnp-{ts}` id；弹窗提示"将保存为新桌游（原《name》不受影响）"（`importedFrom` 标记仅作展示）
- **服务端纵深防御**：`saveGame` 同 id 已存在 → 拒绝并返回 false（`upload_game` 回 error，客户端透传提示）；`server/data/` 被 gitignore，无备份，覆盖不可恢复
- **弹窗互斥**：`importGameOpen` 加入 ESC 菜单 disabled

**否决了什么**：

- **上传幂等覆盖原桌游**：误覆盖即永久丢失（文件直接 writeFileSync、无备份、gitignore），改为永远新建
- **保留旧草稿**：导入即替换，避免下次进 lab 恢复出旧工作区造成困惑

## Lab ESC 控制菜单：功能按键收拢，退出保留并复制

- **日期**：2026-08-23（首次提出）
- **主题**：lab 页面的功能按键从浮动按钮组移入 ESC 菜单（新建 `components/game/LabEscMenu.tsx`）

**决定了什么**：

- **新建 LabEscMenu**（自包含 ESC 监听 + 遮罩点击关闭，同 GameControlPanel 模式）：按钮 = 导入 PDF（主操作）/ 保存 / 上传 / 丢弃草稿（仅草稿恢复时显示）/ ← 广场（红色）；保存/上传沿用原 disabled 逻辑（empty / uploading）
- **右下角浮动组移除**（保存/上传/导入 PDF 全进菜单）；右上角 **← 广场保留**，菜单内复制一份退出入口
- **丢弃按钮移入菜单**，右上角 chip 只留"草稿已恢复"提示文字
- **弹窗与菜单互斥**：`disabled = importOpen || uploadOpen` 时 ESC 不响应；菜单按钮点击先关菜单再执行（避免遮罩叠遮罩）
- **空态提示更新**："按 ESC 打开菜单，点 [导入 PDF] 开始"
- **不复用 GameControlPanel**：对局语义（重新开始/退出）与 lab 操作（保存/上传/导入）差异大，复用需大量无关 prop

**否决了什么**：

- **泛化 GameControlPanel 承载 lab 按钮**：职责混杂，过渡设计

## 桌面网格随缩放/平移（网格 = 桌面坐标层装饰）

- **日期**：2026-08-23（首次提出）
- **主题**：网格状背景从 viewport 层（固定 40px 屏幕像素）改为桌面坐标层，随容器 transform 一起缩放平移

**决定了什么**：

- **网格搬进缩放容器**：GameBoard 的 `<main>` 不再用 `.board-area`（改 `.board-surface` 纯色底），容器内新增 `.board-grid` div（`position:absolute; left/top:-20000; width/height:40000; zIndex:-1; pointerEvents:none`），40px = 桌面坐标格距，线宽随 zoom 缩放（与卡片同比例）
- **尺寸 ±20000**：最小 zoom 0.2 → 4000px 屏宽，4K 拉满有余量；再往外露出纯色底
- **`.board-area` 原样保留**：EntityPanel 导入预览的静态网格继续用它
- **零换算改动**：`toDesk` / dragEnd 落点 / dnd-kit over 检测 / 引擎坐标全部不变；网格纯装饰（不拦截事件、zIndex 垫底，实体 zIndex ≥ 0）

**否决了什么**：

- **CSS background 跟随 view（方案 B）**：background-size/position 随 view 动态化，无限覆盖但线宽恒 1px、亚像素抖动需取整，不如容器内网格直观

## 桌面缩放/平移：容器 transform + UI 层坐标换算（引擎零改动）

- **日期**：2026-08-22（首次提出）
- **主题**：GameBoard 桌面支持缩放（滚轮、鼠标为中心）与平移（拖拽空白处），lab / 试玩 / 对局全模式生效

**决定了什么**：

- **两层坐标系**：引擎 state = 桌面坐标（不变）；渲染容器 `translate(pan) scale(zoom)`（origin 0 0）；换算只在 UI 层
- **换算两处**：dragEnd 落点 `desktop = (viewport - pan) / zoom`（translated 是视口坐标）；拖拽中 transform **÷zoom**（Card/Pile 在缩放容器内，否则视觉位移被放大 zoom 倍不跟手）；HandZone（容器外屏幕 UI）用 zoom=1 不变
- **鼠标中心缩放**：wheel 时保持鼠标下的桌面点不动（`view' = mouse - deskPoint·zoom'`）
- **平移**：拖拽 main 空白处（target 非卡片/牌堆）
- **不受影响**：悬停按键（elementFromPoint 基于渲染像素）、dnd-kit over 检测（视口 rect）、引擎 findOverlap/placeAt（桌面坐标）、lab 网格摆位/草稿坐标
- **view（zoom/pan）为会话 UI 状态**，不入草稿/存档/协议

**否决了什么**：

- **缩放/平移进引擎或存档**：纯 UI 状态，会话内有效即可
- **缩放锚点按钮（左上角）**：用户选鼠标中心（体验版）

## 实体类型判别联合（kind）+ 版图旋转：Prefab 模板不承担能力字段，Entity 公共状态字段带默认值

- **日期**：2026-08-22（首次提出）
- **主题**：版图类型扩展——实体从"可选字段泛化"（size/singleFace）改为 **kind 判别**：卡牌 / Token / 版图。版图支持 R 键顺时针旋转 90°；纯 JSON 数据无法用类继承，判别联合是 TS 的替代

**决定了什么**：

- **Prefab 判别联合**（`kind: "card" | "token" | "board"`）：faces 结构不同（card 正反、token 单面、board 单面）；**模板不承担能力字段**（无 stackable/singleFace——能力由 kind 决定，前端按 kind 区别对待）
- **EntityState 带 kind 判别 + 公共状态字段**：`faceUp`、`rotation`（0/90/180/270）为公共字段**带默认值**（构建/迁移时赋默认，识别代价低）；客户端按 kind 限制功能（**仅 card 可翻**；board 可旋转；board 不可叠不可入手牌）
- **singleFace 删除**：单面实体合并为 token/board（渲染恒正面、F 无效，语义相同）
- **版图（单面）**：无背面（同 token 单面恒正面，flip 拦截）；旋转只改渲染（CSS transform），碰撞盒/叠放判定用未旋转尺寸（版图自由放置不参与堆叠）；`rotate_entity` 进协议动作（对局中也可旋转），服务端分发
- **导入流程**：新建组时三选一（卡牌/Token/版图按钮），**仅卡牌进入选背面流程**（跳过 = 默认卡背）；token/board 单面直接完成，无背面 UI；删除【正反一样】按钮
- **旧数据迁移**：node 脚本把现有 `server/data/games/*.json` 转换为带 kind 结构（prefab 无 kind：`singleFace` → token，否则 card；entity 按 prefab kind 补 + `rotation: 0`）

**否决了什么**：

- **stackable 布尔字段**：kind 已表达能力（版图不可叠），模板不再承担行为字段
- **ItemState 严格分支专属字段**（faceUp 仅 card）：faceUp/rotation 公共带默认值，序列化/构建/识别代价更低，限制放客户端按 kind
- **rotation 仅 board 字段收窄**：公共字段默认 0，客户端限制（与上同理）

## Lab 组装工作台：Import 翻转为主视图 + 多 PDF 导入 + indexDB 草稿

- **日期**：2026-08-22（首次提出）
- **主题**：导入页从"导入为主、Lab 收尾"翻转为"**Lab 为主体**，可反复通过弹窗导入多个 PDF 实体，整体组装为一个桌游"（一个 PnP 桌游多个待打印 PDF，按部分打印最后组装）

**决定了什么**：

- **路由** `/lab` = 桌游组装工作台（原 `/import` 改名）；广场入口「新建桌游」
- **ImportFlow 组件化 + 弹窗**：`components/import/ImportFlow.tsx` 原样复用四段流程（选 PDF → 切割 → 实体定义+图片池 → 实体组 → 导入），不分步改造；弹窗提交后关闭，实体以确定性网格空位（`40 + (idx%5)*300, 40 + floor(idx/5)*320`）上桌，可反复导入
- **工作区 = 全部桌游数据**：`sprites` + `prefabs` + `labState`（布局坐标），与生产架构"资产与状态分离"一致；导入 commit = `buildGameFromGroups(groups, sizes, entityN0, pileN0)` → 合并 + 网格摆位；上传/草稿直接读工作区
- **id 全局计数器**（sprite/entity/pile）：页面存活期不重置，跨批次不碰撞；`buildGameFromGroups` 参数化 `entityN0`/`pileN0`，pile id 从 `pile-{ts+gi}` 改 `pile-{pileN0+gi}`（opaque 无依赖）；恢复草稿时按现有 id 最大序号 +1 续
- **草稿 = indexDB**（`lib/storage/draft.ts`，bob-draft 单槽位）：形状与上传格式同构（meta + assets + 无座 initialState）；**纯手动 [保存] 按钮**（无自动保存、无状态提示）；进入 `/lab` 自动恢复 + 右上角「草稿已恢复 · 丢弃」chip；上传成功后清草稿
- **上传**：组装 meta + assets + initialState（强制 `seats: []`）→ 原 `upload_game` 链路；`game_uploaded` 匹配 gameId → 清草稿 + 跳广场
- **Lab 编辑（本地，不进协议）**：hover 实体按 Delete 删除（引擎导出 `removeEntity` 纯函数：出堆 + 剩余 ≤1 张散堆 + 删实例）；Ctrl/Cmd+D 复制（同 prefab 新实例，偏移 (24,24)，z 置顶，自由牌，`preventDefault` 阻止浏览器书签）；GameBoard 可选 `labMode` prop，play/room 不受影响
- **GeneratePanel 改造**：取消改 `onCancel`（关弹窗），生成改 [导入]（提交）

**否决了什么**：

- **ImportBatch 批次概念**：草稿持久化 + 单实体删除已覆盖"撤销导入"，批次（batches[] + labState 双份数据）冗余
- **弹窗分步化**：用户否决，ImportFlow 原样复用四段流程
- **自动保存 / 未保存状态提示**：用户明确不要，纯手动保存
- **清空工作台按钮**：由「丢弃草稿」chip 取代（持久化下重新进入 = 恢复草稿，需丢弃入口才能重开）
- **对局内删除实体**：需协议动作，另行评估
- **复制整堆**：当前复制单张自由牌
- **Lab 撤销拖摆**：需动作历史栈，不做

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
