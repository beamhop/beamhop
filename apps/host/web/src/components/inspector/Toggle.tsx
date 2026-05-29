/** Labelled on/off switch row with a sub-caption. */
export function Toggle({
  on,
  onChange,
  label,
  sub,
  testid,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub: string;
  testid: string;
}) {
  return (
    <button className="togrow" onClick={() => onChange(!on)} data-testid={testid}>
      <span className="togcol">
        <span className="toglabel">{label}</span>
        <span className="togsub mono">{sub}</span>
      </span>
      <span className={"toggle" + (on ? " on" : "")}>
        <span className="knob" />
      </span>
    </button>
  );
}
