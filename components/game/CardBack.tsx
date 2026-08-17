export default function CardBack() {
  return (
    <div
      className="w-4/5 h-4/5 rounded border-2 border-white/20"
      style={{
        background: `
          repeating-linear-gradient(
            45deg,
            transparent,
            transparent 6px,
            rgba(255,255,255,0.06) 6px,
            rgba(255,255,255,0.06) 12px
          ),
          repeating-linear-gradient(
            -45deg,
            transparent,
            transparent 6px,
            rgba(255,255,255,0.06) 6px,
            rgba(255,255,255,0.06) 12px
          )
        `,
      }}
    />
  );
}
