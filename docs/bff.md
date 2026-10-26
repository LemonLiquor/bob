# BFF（/api/games）

## 链路

```
Lab doUpload()
  → POST /api/games                        app/api/games/route.ts
      ① 流式读 body，超 8MB 立即掐断        → 413 TOO_LARGE
      ② JSON.parse + zod GameBody           → 400 INVALID_BODY
      ③ fetch localhost/internal/games      x-internal-token
  → /internal/games                        server/internal-api.ts
      ④ token 校验 → gameLibrary.saveGame()
      ⑤ 已存在 → 409 GAME_EXISTS，否则 200 { gameId }
```

## 为什么 Route 不直接 import GameLibrary

Next 的 Route Handler 与 index.ts（统一端口入口）是**两套模块图**，各自会加载一份 `game-library.ts`，于是出现两个 `GameLibrary` 实例：内存里的 `Map` 各记一份，「同 id 已存在就拒绝覆盖」的保护会失效，列表也可能不同步。

所以：`index.ts` 建唯一实例并注入给 `createGameWss(lib)`，Route 通过 HTTP 打回同进程的 `/internal/games`。代价是多一次本地 HTTP 往返（同进程，可忽略）；收益是单实例语义不被破坏。

## 错误码

| 码 | HTTP | 触发 |
|---|---|---|
| `INVALID_BODY` | 400 | 非 JSON / zod 校验失败（message 指名出错字段路径） |
| `GAME_EXISTS` | 409 | 上游拒绝覆盖同名桌游 |
| `TOO_LARGE` | 413 | 实测字节数超 `MAX_BODY_BYTES` |
| `UPSTREAM_FAILED` | 500 | 上游不可达或非 2xx |

统一响应体：成功 `{ ok: true, ...data }`，失败 `{ ok: false, code, message }`。

## 为什么不做鉴权

上传是这个项目的**过渡态**。目标态是去中心化——桌游留在各自客户端，游玩时才上传；那个形态里的身份属于节点，不属于会话。现在加 cookie 会话鉴权，等上传改成点对点之后要整块拆掉。

保留的三层（体积 / 校验 / 错误码）与「上传到哪里」无关，换形态能原样迁移。

## 用到的 Node 能力

- 流式读请求体：`req.body.getReader()` 逐块累加，超限 `reader.cancel()`（不是先 `req.text()` 读完再判断，那样上限形同虚设）
- `Buffer.from` / `Buffer.concat` 拼块，`toString("utf-8")` 转字符串
- `node:http` 的 `IncomingMessage` 异步迭代读上游 body、`writeHead` 手写响应
- `index.ts` 在 `createServer` 里按路径分流（`/internal/*` 不走 Next 路由表）
- 进程内 `fetch` 转发，异常映射为 500（未设超时）

## 验证

```bash
npm run dev
# 形状错
curl -s -X POST http://localhost:3000/api/games -H 'content-type: application/json' \
  -d '{"meta":{"id":"x","name":"n","icon":"i"},"assets":{"sprites":[{"id":"s1","url":"http://e/x.png"}],"prefabs":[]},"initialState":{"entities":[],"piles":[],"seats":[]}}'
# → 400 {"ok":false,"code":"INVALID_BODY","message":"assets.sprites.0.url: 必须是 dataURL"}
```

正常包 → 200 且 `server/data/games/<id>.json` 落盘；同 id 再传 → 409；超 8MB → 413。
