# ROADMAP

## 规划中

- **桌游实体扩充**：Token / 版图已落地（`kind` 判别联合 + 动作注册表，见 `docs/architecture.md`）；骰子 / 米宝规划中（骰子 = faces 数组化 + faceIndex，结构性差异，届时再评估 union 收窄）
- **实体放置与版图**：版图不可叠已落地（`kind: "board"`，`placeAt` 跳过建堆）；实体覆盖放置在版图之上（自由坐标落于版图区域）基础已就绪；后续可支持 hex 网格吸附拼接
- **GitHub Release 上传编译产物**：打 tag 发布时由 CI 自动构建，把编译产物（如网页版打包、桌面端安装包）上传到 GitHub Release，用户可直接下载
- **桌面多主题可切换**：GameBoard 支持多套可切换主题
