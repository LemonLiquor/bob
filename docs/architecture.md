# 架构地图

改代码前先读。分层与关键机制。

## 分层

| 层 | 位置 | 职责 |
|----|------|------|
| 引擎 | `lib/engine/` | 纯函数（types / actions / layout / demo-data / reducers），零 UI 依赖，客户端与服务端共用 |
| 资产 | `lib/assets/` | 卡牌资产内存缓存（静态层，进房一次性加载） |
| PnP | `lib/pnp/` | PDF 渲染 + 网格裁切 + 实体定义（圆形遮罩透明 PNG）+ 实体组摊平 |
| 联机 | `lib/multiplayer/` | WS 连接 / 协议 / session / transport |
| UI | `components/` | React 组件（game / lobby / room），`app/` 为路由 |
| 服务端 | `server/` | WS 服务器（handlers / room-manager / game-library），独立进程 `:3001` |

## 关键机制

- **资产与状态分离**：`Asset`（图片 dataURL）是静态层，进房一次性下发；`GameState` 是纯逻辑状态，`state_sync` 不携带图片，渲染时按 id 查表
- **动作注册表**：`lib/engine/reducers.ts` 一份动作分发，GameBoard 与服务端共用。新增动作 = 协议加类型 + 注册表加条目，分发层零改动
- **服务端权威**：服务端顺序应用动作即权威，`state_sync` 广播全量状态；无效动作（状态未变）不广播
- **实体类型 = kind 判别联合**：`Prefab`/`EntityState` 带 `kind: "card" | "token" | "board"`（纯 JSON 数据下 union 是类继承的替代）。**模板不承担能力字段**（无 stackable/singleFace），能力由 kind 决定、前端按 kind 区别对待：card 可翻可叠可洗牌、token 单面禁翻（恒正面）可叠、board 单面可旋转（R 顺时针 90°）不可叠不可入手牌；`Prefab.size`（缺省 120×168 卡牌）定义渲染尺寸，构建时复制到 `EntityState.size`（物理属性，随 state_sync）；**不同尺寸不可堆叠**（`placeAt` 同尺寸校验，缺省归一比较）；`EntityState` 公共状态字段 `faceUp`/`rotation` 带默认值（识别代价低）；旋转只影响渲染（CSS transform），碰撞盒用未旋转尺寸；骰子等多面实体（faces 数组化）留待后续
- **实体形状在取图时定**：圆形 = canvas 圆形遮罩生成透明背景 PNG（`toCircular`），渲染层只有矩形 + 透明图，无 shape 字段/分支；不规则的米宝类靠透明 PNG 素材
- **坐标体系**：游戏页全屏布局，视口坐标 = 桌面坐标，无需换算；手牌区是屏幕 UI 组件，不在桌面坐标系（自己底部展开 / 他人顶部折叠条）
- **初始状态固化**：初始状态在导入时生成（无座 `initialState`，坐标由导入页 Lab 沙盒自定义），随桌游 json 存档；创建房间时服务端深拷贝并补 1 个默认空座（复用 `createSeat`）；试玩 / 开房 / 重新开始直接使用，无运行时派生（`buildGame` 已删除）；重新开始 = 回 initialState + 保留座位实例与归属、仅清空手牌
