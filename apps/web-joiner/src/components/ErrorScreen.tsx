export interface ErrorScreenProps {
  title: string;
  detail?: string;
}

export function ErrorScreen({ title, detail }: ErrorScreenProps) {
  return (
    <main className="min-h-full flex flex-col items-center justify-center px-6 py-16 max-w-[42rem] mx-auto text-center">
      <div
        className="text-[10px] uppercase tracking-[0.5em] text-[var(--color-rust)] mb-6"
        style={{ fontFamily: "var(--font-body)" }}
      >
        — connection refused —
      </div>
      <pre
        className="text-[var(--color-amber)] text-[0.55rem] leading-none mb-8 select-none"
        style={{ fontFamily: "var(--font-body)" }}
      >
{`  ╔══════════╗
  ║ ╳     ╳  ║
  ║    ─     ║
  ╚══════════╝`}
      </pre>
      <h1
        className="text-5xl mb-5 leading-tight"
        style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}
      >
        {title}
      </h1>
      {detail && (
        <p
          className="text-[var(--color-ink-soft)] text-base mb-10 max-w-[40ch]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {detail}
        </p>
      )}
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          window.location.hash = "";
        }}
        className="inline-flex items-center gap-2 bg-[var(--color-ink)] text-[var(--color-paper)] px-5 py-3 text-sm uppercase tracking-[0.25em] hover:bg-[var(--color-amber)] hover:text-[var(--color-ink)] transition-colors"
        style={{ fontFamily: "var(--font-body)" }}
      >
        ← back to landing
      </a>
    </main>
  );
}
