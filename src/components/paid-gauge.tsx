const GAUGE_TICKS = 12;
/** Server and browser Math.sin differ in the last digit; rounding keeps hydration identical. */
const px = (n: number) => Math.round(n * 100) / 100;

/** Half-ring of ticks filled to a share (mockups): green when complete, amber from half, red below. */
export function PaidGauge({ percent, className }: { percent: number; className?: string }) {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * GAUGE_TICKS);
  const tone = percent >= 100 ? "var(--success)" : percent >= 50 ? "var(--warning)" : "var(--danger)";
  return (
    <svg viewBox="0 0 64 36" className={className ?? "h-9 w-16 shrink-0"} aria-hidden>
      {Array.from({ length: GAUGE_TICKS }, (_, i) => {
        const angle = Math.PI - (i / (GAUGE_TICKS - 1)) * Math.PI;
        const [cx, cy, r1, r2] = [32, 32, 20, 28];
        return (
          <line
            key={i}
            x1={px(cx + r1 * Math.cos(angle))}
            y1={px(cy - r1 * Math.sin(angle))}
            x2={px(cx + r2 * Math.cos(angle))}
            y2={px(cy - r2 * Math.sin(angle))}
            stroke={i < filled ? tone : "var(--border)"}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}
