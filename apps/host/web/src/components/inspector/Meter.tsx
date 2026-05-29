/** Horizontal labelled bar meter. `val`/`total` set the fill fraction. */
export function Meter({
  label,
  val,
  total,
  color,
}: {
  label: string;
  val: number;
  total: number;
  color: string;
}) {
  return (
    <div className="meter">
      <div className="meterhead">
        <span className="meterlabel mono">{label}</span>
        <span className="meterval mono">
          {val >= 1000 ? (val / 1000).toFixed(1) + "k" : val}
        </span>
      </div>
      <div className="metertrack">
        <span
          className="meterfill"
          style={{ width: Math.min(100, (val / total) * 100) + "%", background: color }}
        />
      </div>
    </div>
  );
}
