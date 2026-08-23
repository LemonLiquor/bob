# BOB — Box of Boardgames（桌游沙盒）

> **B-O-B**：Box of Boardgames。把桌游装进一个盒子里，在浏览器里打开就能玩。

网页桌游沙盒：上传 PDF 生成桌游，浏览器里拖拽操作。沙盒模式——规则由玩家自己遵守，游戏只提供"桌子"。

## 功能

- **核心沙盒**：卡牌自由拖放、翻面（F）、洗牌（R）、翻整叠（hover 牌堆 + Shift+F）；两张牌重叠自动合成牌堆（Pile）；hover 任意牌按 D 抓入手牌
- **手牌区**：自己的在屏幕底部展开，其他玩家的在屏幕顶部折叠条（卡背 + 张数）
- **PnP 图片导入**：上传 PDF → 网格裁切生成卡牌资产（正反页镜像配对）→ 存入桌游库
- **座位系统**：手动入座 / 离座，手牌跟座位走（离座时手牌掉落桌面中心），座位上限 6
- **多人联机**（独立 WS 服务器 `:3001`）：创建房间（4 位房间码）/ 加入房间、游戏状态实时同步、ESC 控制面板（重新开始 / 退出房间）、断线自动重连 + 全量状态恢复
- **资产与状态分离**：卡牌图片进房一次性加载，状态同步不携带图片
- **桌面缩放/平移**：滚轮缩放（鼠标为中心）+ 空白拖拽平移，网格背景随容器缩放；拖拽中实体 zIndex 置顶不被版图遮挡
- **Lab 组装工作台**（`/lab`）：ESC 菜单（导入 PDF / 导入桌游 / 手绘实体 / 保存 / 上传 / 退出）；从现有桌游基础上修改（上传幂等覆盖）；草稿本地保存恢复
- **手绘实体**：画笔（6 色 / 3 档笔粗）/ 填色 / 橡皮 / 撤销；贴纸 = emoji 全量输入 + 本地图片导入 + 导入历史，放置模式（拖动定位 / 滚轮·px 精确缩放 / 预览即渲染）；kind 三 tab（卡牌默认卡背 / Token / 版图）
- **实体类型判别**（card / token / board）：卡牌可翻可叠、token 单面可叠、版图单面可 R 旋转（90°）不可叠；不同尺寸不可堆叠

## TODO
- [x] 桌面缩放 / 平移（滚轮缩放，拖拽空白处平移）
- [x] 卡牌 / Token / 版图三种实体：翻面、洗牌、整叠翻面、版图旋转
- [x] 手牌区（自己的展开、别人的折叠条）
- [x] Lab 组装工作台：导入 PDF、手绘实体、从现有桌游修改、保存草稿、上传发布
- [x] 多人房间联机（创建 / 加入 / 断线重连）
- [ ] 卡牌可以横着放（旋转 90°）
- [x] 移动版图时，放在上面的卡牌和棋子一起移动
- [ ] 骰子
- [ ] 整理手牌顺序
- [ ] 一次选中多张卡牌一起移动
- [ ] 大型桌游（几百个组件）流畅运行
- [ ] 版图可以任意角度旋转
- [ ] 六边形网格桌游支持
- [ ] 桌面多套配色主题
- [ ] 打包好的安装包（网页版 / 桌面版）


## 技术栈

- Next.js 16（App Router + Turbopack）+ TypeScript + Tailwind CSS v4
- @dnd-kit/core — 拖拽
- ws — WebSocket 服务器（端口 3001，与 Next.js 3000 分离，避免 HMR 冲突）
- pdfjs-dist — PDF 渲染
- zod — 数据校验

## 快速开始

```bash
npm install
npm run dev       # Next.js → http://localhost:3000
npm run dev:ws    # 多人联机 WS 服务器 → :3001（单机试玩可不开）
```

浏览器打开 `http://localhost:3000`，输入昵称进入游戏广场：导入 PDF 生成桌游、试玩、或创建房间多人游玩。

## 项目结构

```
bob/
├── app/
│   ├── layout.tsx                   # 根布局（WS 连接生命周期，全 app 只连一次）
│   ├── login/                       # 昵称登录页
│   ├── (main)/                      # 带顶部导航的页面组
│   │   ├── games/                   # 游戏广场：桌游列表、导入、开房/加房
│   │   └── import/                  # PnP PDF 导入页
│   └── (game)/                      # 游戏全屏页面组（board 占满视口）
│       ├── game/[gameId]/play/      # 单机试玩
│       ├── game/[gameId]/room/      # 创建房间中转页
│       └── room/[code]/             # 多人对局房间
├── components/
│   ├── game/                        # Card / CardBack / Pile / GameBoard / GameControlPanel
│   ├── lobby/                       # WsConnection / JoinRoomCard
│   └── room/                        # RoomPanel
├── lib/
│   ├── engine/                      # 核心引擎纯函数（types / actions / layout / build-game）
│   │   └── card-action/             # 悬停快捷键交互
│   ├── pnp/                         # PDF 渲染 + 网格裁切
│   ├── assets/                      # 卡牌资产内存缓存
│   └── multiplayer/                 # 联机（connection / protocol / session / transport）
└── server/                          # WS 服务器（index / handlers / room-manager / game-library）
```

## 相关文档

| 文档 | 内容 |
|------|------|
| [AGENTS.md](AGENTS.md) | 给 AI 代理与协作者的常驻命令（角色检查 / 需求格式 / 硬性规则） |
| [docs/architecture.md](docs/architecture.md) | 架构地图：分层与关键机制 |
| [docs/practices.md](docs/practices.md) | 协作实践：讨论循环、角色方法 |
| [docs/notes/](docs/notes/) | 决策记录（为什么 / 放弃了什么） |

## 架构要点

- **引擎纯函数**：`lib/engine` 是零 UI 依赖的纯函数层（不可变更新），客户端和服务端共用
- **动作注册表**：`lib/engine/reducers.ts` 一份动作分发，GameBoard 与服务端共用，新增动作零改分发层
- **服务端权威**：服务端顺序应用动作即权威，`state_sync` 广播全量状态
