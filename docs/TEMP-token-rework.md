# 临时需求文档：Token 实体（多种尺寸/形状的实体：卡牌 + 小型板块 + 圆形筹码）

> ⚠️ 临时文件：完成需求后删除。正式记录落盘到 docs/architecture.md + docs/notes/implemented.md。
> 命名约定：文档与代码不出现具体桌游名/产品名/品牌。

## 背景与目标

现有实体全部是卡牌（120×168 矩形，渲染硬编码）。桌游常见实体组合包含：标准卡牌 + **不同尺寸的矩形板块** + **圆形筹码（token）**。本次新增"可变尺寸实体"：新增**实体定义面板**（页面预览与图片池之间），每张切图定义"形状 + 实际渲染大小"；**默认 = 现有卡牌设计（矩形 + 120×168），零操作**。

## 数据契约

```
Prefab = { id, faces: { front, back }, size?: { width, height }, singleFace?: boolean }
```

- `size` 可选 → 旧数据零迁移（loadAll 格式校验不变）；缺省 120×168 = 卡牌
- `singleFace?: boolean`（缺省 false = 卡牌双面）：true = **永远显示正面图，F 翻面无效果**，`back` 置空（不再重复引用同一 sprite）；版图/米宝等单面实体未来同字段适用
- **不引入 shape 字段**：圆形在实体定义面板用 canvas 圆形遮罩生成**透明背景 PNG**，渲染层只有矩形 + 透明图，无形状分支
- 每张切图的信息 = 形状（矩形/圆形）+ 切割大小（裁剪像素，只读）+ 实际渲染大小（桌面显示尺寸，可设）
- 骰子等多面实体（faces 数组化 + faceIndex）为更大重构，本次不做（列入后续需求）

## 页面结构（新面板位置）

```
选 PDF → 页面选择/切割参数 → 页面预览 → [实体定义面板] → 图片池 → 组卡 → Lab → 上传
```

- **实体定义面板**：图片网格；每图展示：缩略图 + 编号 + 形状徽标（▢/⚪）+ 切割大小（只读）+ 渲染大小
- 默认全部矩形、渲染 120×168（= 现有卡牌，无任何处理）
- 交互：点图右上角徽标切换形状；多选 + 底部工具条批量设置（形状按钮组 + 宽高输入 + 应用）；圆形即时生成透明 PNG，原始矩形可恢复
- 组卡不再设置尺寸（sprite 在面板已定义），生成 prefab 时 `size` 继承自该图的渲染大小

## 实施步骤（按用户可验收的功能分步）

---

### S1：实体定义面板（形状 + 渲染大小 + 切割大小只读）

**能力**：裁剪完成后，页面预览与图片池之间出现实体定义面板：默认全部矩形 120×168 零处理；每图徽标切换圆形（即时透明 PNG）/恢复矩形；多选批量设置形状与渲染大小；切割大小只读展示。处理后图片池展示最终效果。

**改**：
- `lib/pnp/crop.ts`：新增 `toCircular(dataURL: string): Promise<string>`——canvas 载入 → 圆形 clip → 导出透明 PNG
- 新增 `components/import/EntityPanel.tsx`：
  - props：sprites（原始/处理后）、shapeMap、sizeMap、onToggleShape、onSetSize、onBatchShape、onBatchSize
  - 图片网格：缩略图 + 编号 + 形状徽标（点击切换）+ 切割大小（图片像素，只读）+ 渲染大小（宽高数字）
  - 多选 + 底部工具条：形状按钮（矩形/圆形）+ 宽高输入 + "应用到选中"
- `app/(main)/import/page.tsx`：
  - shape 状态：`spriteId → "rect" | "circle"`（默认全 rect）；size 状态：`spriteId → {width,height} | undefined`（默认 undefined = 120×168）
  - 圆形处理异步（toCircular），处理中该图禁用；原始矩形 dataURL 暂存（恢复用）
  - 面板置于页面预览与图片池之间；重新裁剪 → 状态重置

**验收**：
- 裁剪后面板出现于预览下方：全部矩形徽标 ▢、渲染大小显示 120×168（或留空 = 默认）、切割大小显示实际像素
- 点徽标 → 图变圆形（透明背景）；再点 → 恢复矩形
- 多选 → 工具条"设为圆形" + 宽 48 高 48 + 应用 → 批量变圆且尺寸更新
- 重新裁剪 → 面板重置
- 图片池/组卡缩略图显示最终形状与尺寸

---

### S2：生成链路带 size（prefab 继承渲染大小）

**能力**：生成 json 时 prefab 带 `size`（来自实体定义面板的渲染大小；未设置 = 无 size 字段，卡牌默认）。

**改**：
- `lib/pnp/crop.ts`：`buildGameFromGroups(groups, sizes?: Map<string, { width: number; height: number }>)`——摊平 prefab 时按项正面 spriteId 查 sizes，查到则带 `size`，否则不带
- `app/(main)/import/page.tsx`：`handleGenerate` 传入 sizeMap
- 自动正反交替组卡：不涉及（sprite 的尺寸由面板定义，自动继承）

**验收**：
- 面板设置某图为 48×48 → 生成 json 该卡 prefab 含 `"size": { "width": 48, "height": 48 }`
- 未设置 → prefabs **无 size 字段**
- 圆形图 → sprites 中为透明 PNG（面板已处理），prefabs 引用不变

---

### S3：渲染与引擎按尺寸适配

**能力**：48px 圆形筹码渲染为圆形小图、可拖拽；Pile 容器/堆叠/重叠判定随实体尺寸。

**改**：
- `lib/assets/cache.ts`：新增 `getPrefabSize(prefabId): { width, height } | undefined`（缺省 undefined）
- `components/game/Card.tsx`：容器尺寸按 `getPrefabSize`（缺省 120×168）；圆形透明图原样显示
- `components/game/Pile.tsx`：容器宽高按首张牌尺寸（`getPrefabSize`，缺省 120×168）；`stackLayout` 偏移按尺寸等比缩放（或按尺寸传参）
- `lib/engine/layout.ts`：`stackLayout` 增加尺寸参数（偏移 = 尺寸比例 × 原偏移）
- `lib/engine/actions.ts` `findOverlap`：重叠阈值按实体尺寸（中心距 < 尺寸相关距离，小实体更近才算）
- `lib/engine/actions.ts` `placeAt`：**不同尺寸不可堆叠**——入堆/建堆前校验尺寸相同（缺省 120×168 归一比较），尺寸不同 → 自由放置（可重叠）
- `lib/engine/types.ts` `EntityState` 增加 `size?`（从 prefab 复制，构建时填充，随 state_sync 传输）
- 手牌区：**不特别处理**（token 可进手牌，按现有卡牌布局）

**验收**：
- 试玩/Lab：48px 圆形筹码正确显示（透明背景圆形）、可单拖、可 Shift 整堆移
- 筹码堆：Pile 虚线框 48px、堆叠偏移小、张数角标正常
- 筹码与卡牌重叠判定：筹码中心距近才合成堆（小尺寸不误吸）
- **不同尺寸不可堆叠**：48px 筹码拖到 120×168 卡牌/卡牌堆上 → 不合成堆（自由放置）；同尺寸互拖正常合成堆；旧数据（无 size）卡牌互拖正常成堆
- 卡牌行为完全不变（无 size = 120×168 原路径）

---

### S4：端到端验收（多实体混合导入）

**验收**：
- 一份含卡牌页 + 板块页 + 筹码页的 PDF：卡牌页默认组卡（120×168）、板块页面板设自定义尺寸、筹码页面板转圆 + 设 48px
- 上传 json：sprites（含透明圆 PNG）+ prefabs（部分带 size）
- 试玩：三类实体同屏正确显示；Lab 可摆；多人经 state_sync 正常

## 关联

- **依赖**：导入页重构（S1-S7，已完成）
- **被依赖**：ROADMAP「实体放置与版图」（实体覆盖放置、不可叠放、网格吸附——后续）
- **文档**：完成后更新 `docs/architecture.md`（实体尺寸机制）+ implemented note

## 边界（本次不做）

- 每页独立切割参数（裁剪网格全局，分辨率足够显示尺寸缩放）
- 形状类型扩充（多边形/不规则：靠透明 PNG 素材，无需代码）
- 实体覆盖放置、不可叠放标记（ROADMAP）
- 手牌区按尺寸布局
