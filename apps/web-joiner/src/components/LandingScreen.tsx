export function LandingScreen() {
  return (
    <main className="min-h-full flex flex-col items-stretch px-6 sm:px-10 py-12 max-w-[68rem] mx-auto">
      {/* Editorial masthead */}
      <header className="flex items-baseline justify-between mb-16 border-b-2 border-[var(--color-ink)] pb-3">
        <div className="flex items-baseline gap-3">
          <span
            className="text-[var(--color-amber)] text-2xl tracking-tighter font-bold"
            style={{ fontFamily: "var(--font-body)" }}
          >
            ▲
          </span>
          <span
            className="text-sm uppercase tracking-[0.3em]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            beamhop / web-joiner
          </span>
        </div>
        <span
          className="text-xs uppercase tracking-widest text-[var(--color-ash)]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          v 0.1 — preview
        </span>
      </header>

      {/* Hero */}
      <section className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-12 lg:gap-16 mb-20">
        <div className="fade-up" style={{ animationDelay: "0.05s" }}>
          <div
            className="text-xs uppercase tracking-[0.4em] text-[var(--color-rust)] mb-6"
            style={{ fontFamily: "var(--font-body)" }}
          >
            no link detected
          </div>
          <h1
            className="text-[3.25rem] sm:text-[4.5rem] leading-[0.95] tracking-tight mb-6"
            style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}
          >
            <span className="text-[var(--color-ink)]">paste a&nbsp;</span>
            <span className="text-[var(--color-amber)]">join link</span>
            <span className="text-[var(--color-ink)]">,<br />step into someone&apos;s</span>
            <br />
            <span className="text-[var(--color-ink)]">sandbox.</span>
          </h1>
          <p
            className="text-[var(--color-ink-soft)] text-lg max-w-[36ch] leading-relaxed"
            style={{ fontFamily: "var(--font-body)" }}
          >
            Direct peer-to-peer. No server in the middle. Your host runs the
            sandbox; you get a terminal. Close the tab and the connection is
            gone.
          </p>
        </div>

        {/* Mini terminal preview */}
        <aside
          className="fade-up relative"
          style={{ animationDelay: "0.2s" }}
        >
          <div className="ascii-frame relative bg-[#15100a] text-[#fbbf24] rounded-sm p-5 shadow-[0_22px_60px_-30px_rgba(146,64,14,0.6)] border border-[var(--color-rust)]/30">
            <div className="flex items-center gap-2 mb-3 text-[10px] uppercase tracking-[0.25em] text-[#92400e]">
              <span className="w-2 h-2 rounded-full bg-[#dc2626]"></span>
              <span className="w-2 h-2 rounded-full bg-[#f59e0b]"></span>
              <span className="w-2 h-2 rounded-full bg-[#16a34a]"></span>
              <span className="ml-3">sandbox · sb_ab12cd</span>
            </div>
            <pre
              className="text-[12px] leading-relaxed whitespace-pre-wrap"
              style={{ fontFamily: "var(--font-terminal)" }}
            >
{`/ # whoami
root
/ # uname -a
Linux beamhop 6.6.0 #1 SMP aarch64 GNU/Linux
/ # _`}<span className="cursor-blink">█</span>
            </pre>
            <div className="scan-sweep" />
          </div>
        </aside>
      </section>

      {/* How-to triptych */}
      <section
        className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--color-ink)] border-2 border-[var(--color-ink)] mb-16"
      >
        {[
          {
            n: "01",
            t: "host shares",
            d: "Desktop user toggles a session to public and gets a link.",
          },
          {
            n: "02",
            t: "you paste",
            d: "Drop the link into your address bar. The fragment after # carries the room + token.",
          },
          {
            n: "03",
            t: "p2p",
            d: "Your browser dials a WebRTC connection through public signaling. No data hits a server.",
          },
        ].map((step, i) => (
          <article
            key={step.n}
            className="bg-[var(--color-paper-deep)] p-6 flex flex-col gap-3 fade-up"
            style={{ animationDelay: `${0.35 + i * 0.1}s` }}
          >
            <div className="flex items-baseline justify-between">
              <span
                className="text-3xl text-[var(--color-amber)] font-bold"
                style={{ fontFamily: "var(--font-body)" }}
              >
                {step.n}
              </span>
              <span
                className="text-[10px] uppercase tracking-[0.3em] text-[var(--color-rust)]"
                style={{ fontFamily: "var(--font-body)" }}
              >
                step
              </span>
            </div>
            <h3
              className="text-2xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {step.t}
            </h3>
            <p
              className="text-sm text-[var(--color-ink-soft)] leading-relaxed"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {step.d}
            </p>
          </article>
        ))}
      </section>

      {/* Try-it row */}
      <section
        className="border-t border-[var(--color-ink)] pt-8 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-6 fade-up"
        style={{ animationDelay: "0.65s" }}
      >
        <div>
          <div
            className="text-[10px] uppercase tracking-[0.4em] text-[var(--color-rust)] mb-2"
            style={{ fontFamily: "var(--font-body)" }}
          >
            try a fake invite
          </div>
          <p
            className="text-base text-[var(--color-ink-soft)] max-w-[44ch]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            No host running? Visit a synthetic invite to see the joiner&apos;s
            connecting state — it will time out gracefully.
          </p>
        </div>
        <a
          href="#v=1&k=terminal&r=demo-room&t=demo-token"
          className="group inline-flex items-center gap-2 bg-[var(--color-ink)] text-[var(--color-paper)] px-5 py-3 text-sm uppercase tracking-[0.25em] hover:bg-[var(--color-amber)] hover:text-[var(--color-ink)] transition-colors"
          style={{ fontFamily: "var(--font-body)" }}
        >
          <span>load demo invite</span>
          <span className="transition-transform group-hover:translate-x-1">→</span>
        </a>
      </section>

      <footer
        className="mt-20 pt-6 border-t border-[var(--color-ink)]/30 flex items-baseline justify-between text-[10px] uppercase tracking-[0.3em] text-[var(--color-ash)]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        <span>beamhop // open source // apache 2.0</span>
        <span className="flicker">● signal: nostr · default</span>
      </footer>
    </main>
  );
}
