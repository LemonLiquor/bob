# 架构地图

改代码前先读。分层与关键机制。

## 分层

| 层 | 位置 | 职责 |
|----|------|------|
| 引擎 | `lib/engine/` | 纯函数（types / actions / layout / demo-data / reducers），零 UI 依赖，客户端与服务端共用 |
| 资产 | `lib/assets/` | 卡牌资产内存缓存（静态层，进房一次性加载） |
| PnP | `lib/pnp/` | PDF 渲染 + 网格裁切（正反页镜像配对） |
| 联机 | `lib/multiplayer/` | WS 连接 / 协议 / session / transport |
| UI | `components/` | React 组件（game / lobby / room），`app/` 为路由 |
| 服务端 | `server/` | WS 服务器（handlers / room-manager / game-library），独立进程 `:3001` |

## 关键机制

- **资产与状态分离**：`Asset`（图片 dataURL）是静态层，进房一次性下发；`GameState` 是纯逻辑状态，`state_sync` 不携带图片，渲染时按 id 查表
- **动作注册表**：`lib/engine/reducers.ts` 一份动作分发，GameBoard 与服务端共用。新增动作 = 协议加类型 + 注册表加条目，分发层零改动
- **服务端权威**：服务端顺序应用动作即权威，`state_sync` 广播全量状态；无效动作（状态未变）不广播
- **实体判别联合**：`ItemState`（`kind` + 扩展字段，`faceUp` 卡牌专属）。容器不统一：Pile / HandZone 独立（见 `docs/notes/rejected.md`）
- **坐标体系**：游戏页全屏布局，视口坐标 = 桌面坐标，无需换算；手牌区是屏幕 UI 组件，不在桌面坐标系（自己底部展开 / 他人顶部折叠条）
- **初始状态固化**：初始状态在导入时生成（无座 `initialState`，坐标由导入页 Lab 沙盒自定义），随桌游 json 存档；创建房间时服务端深拷贝并补 1 个默认空座（复用 `createSeat`）；试玩 / 开房 / 重新开始直接使用，无运行时派生（`buildGame` 已删除）；重新开始 = 回 initialState + 保留座位实例与归属、仅清空手牌
