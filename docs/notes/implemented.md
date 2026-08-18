# implemented — 已落地的决策

> 记录决定了什么 + 否决了什么，**与代码保持同步**（代码改名/移动时同步更新事实）。
> 单文件多条目，小项目不建目录；条目按日期倒序。

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
