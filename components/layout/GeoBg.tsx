// Bauhaus 几何背景（固定层，透明度 0.06，不响应事件）
export default function GeoBg() {
  return (
    <div className="geo-bg" aria-hidden>
      <div className="geo-circle" style={{ width: 240, height: 240, top: -60, right: -40 }} />
      <div className="geo-rect" style={{ width: 90, height: 90, top: "38%", left: "6%", transform: "rotate(45deg)" }} />
      <div className="geo-circle" style={{ width: 150, height: 150, bottom: "8%", left: -30 }} />
      <div className="geo-triangle" style={{ bottom: "18%", right: "10%" }} />
      <div className="geo-rect" style={{ width: 46, height: 46, top: "14%", left: "28%", transform: "rotate(20deg)" }} />
      <div className="geo-circle" style={{ width: 70, height: 70, top: "58%", right: "30%" }} />
    </div>
  );
}
