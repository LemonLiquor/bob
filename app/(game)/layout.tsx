// 游戏全屏布局：children 占据整个视口（无 nav）。
// 目的：board（GameBoard 的 main）左上角 = 视口 (0,0)，
// 使 dnd-kit 的视口坐标 = gamestate 桌面坐标 = absolute 渲染坐标，三套坐标统一，无需换算。
export default function GameLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-screen overflow-hidden">{children}</div>;
}
