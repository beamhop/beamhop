export function BootScreen({
  state,
}: {
  state:
    | { kind: "discovering" }
    | { kind: "no-port"; hint: string }
    | { kind: "failed"; error: string };
}) {
  const title =
    state.kind === "discovering"
      ? "booting…"
      : state.kind === "no-port"
        ? "no sidecar"
        : "sidecar failure";
  const detail =
    state.kind === "discovering"
      ? "negotiating with the host sidecar"
      : state.kind === "no-port"
        ? state.hint
        : state.error;
  return (
    <main className="h-screen flex flex-col items-center justify-center px-8 text-center">
      <div
        className="text-[10px] uppercase tracking-[0.5em] text-[var(--color-rust)] mb-6 flicker"
        style={{ fontFamily: "var(--font-body)" }}
      >
        beamhop // desktop
      </div>
      <pre
        className="text-[var(--color-amber)] text-[0.55rem] leading-none mb-8 select-none"
        style={{ fontFamily: "var(--font-body)" }}
      >
{`     ▲
   ╔═══╗
   ║   ║
   ╚═╤═╝
     │
   ──┴──`}
      </pre>
      <h1
        className="text-4xl mb-3"
        style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}
      >
        {title}
      </h1>
      <p
        className="text-[var(--color-ink-soft)] max-w-[44ch] text-sm leading-relaxed"
        style={{ fontFamily: "var(--font-body)" }}
      >
        {detail}
      </p>
    </main>
  );
}
