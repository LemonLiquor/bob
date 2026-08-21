# ROADMAP

## 规划中

- **桌游实体扩充**：Token / 骰子 / 米宝 / 板块（架构地基已就绪：`ItemState` 判别联合 + 动作注册表，见 `docs/architecture.md`）
- **实体放置与版图**：米宝等实体可覆盖放置在版图/卡牌之上（不合成堆）；版图设计为不可叠放（`Prefab.stackable: false`，引擎跳过自动建堆）；后续可支持 hex 网格吸附拼接
- **GitHub Release 上传编译产物**：打 tag 发布时由 CI 自动构建，把编译产物（如网页版打包、桌面端安装包）上传到 GitHub Release，用户可直接下载
- **桌面多主题可切换**：GameBoard 支持多套可切换主题
