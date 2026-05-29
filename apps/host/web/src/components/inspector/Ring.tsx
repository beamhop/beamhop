/** SVG context-usage ring. `pct` is 0–100; color escalates amber→red. */
export function Ring({ pct }: { pct: number }) {
  const R = 34,
    C = 2 * Math.PI * R;
  const off = C * (1 - Math.min(pct, 100) / 100);
  const col = pct > 85 ? "var(--red)" : pct > 65 ? "var(--amber)" : "var(--accent)";
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" className="ring" data-testid="inspector-context-ring">
      <circle cx="42" cy="42" r={R} fill="none" stroke="var(--line)" strokeWidth="7" />
      <circle
        cx="42"
        cy="42"
        r={R}
        fill="none"
        stroke={col}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={off}
        transform="rotate(-90 42 42)"
        style={{ transition: "stroke-dashoffset .5s ease, stroke .3s" }}
      />
      <text x="42" y="39" textAnchor="middle" className="ringpct">
        {Math.round(pct)}
        <tspan className="ringpctsign">%</tspan>
      </text>
      <text x="42" y="54" textAnchor="middle" className="ringcap">
        context
      </text>
    </svg>
  );
}
