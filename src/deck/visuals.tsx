/* ============================================================
   Deck beam visuals — self-contained, auto-looping monochrome
   motifs reused from the marketing brand. Strict black & white:
   white is the live signal, the only thing that moves.
   Each respects reduced motion via the `reduced` prop.
   ============================================================ */
import RobotAvatar from "../components/RobotAvatar";

type VizProps = { reduced?: boolean };

const Check = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12l4 4L19 7" />
  </svg>
);

/* ---------- 1. Constellation (product / the network) ---------- */

const NODES = [
  { x: 15, y: 24, kind: "person", label: "JD", handle: "founder" },
  { x: 85, y: 21, kind: "agent", label: "Atlas", handle: "research" },
  { x: 85, y: 72, kind: "person", label: "MO", handle: "design" },
  { x: 15, y: 72, kind: "agent", label: "Scout", handle: "ops" },
  { x: 50, y: 86, kind: "person", label: "AB", handle: "eng" },
] as const;

export function ConstellationViz({ reduced }: VizProps) {
  return (
    <div className="dv dv-constellation" aria-hidden="true">
      <svg className="dv-beams" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="dv-beam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="oklch(100% 0 0 / 0)" />
            <stop offset="0.5" stopColor="oklch(100% 0 0 / 0.9)" />
            <stop offset="1" stopColor="oklch(100% 0 0 / 0)" />
          </linearGradient>
        </defs>
        {NODES.map((n, i) => (
          <line key={`r${i}`} className="dv-rail" x1="50" y1="50" x2={n.x} y2={n.y} />
        ))}
        {NODES.map((n, i) => (
          <line
            key={`f${i}`}
            className={"dv-flow" + (reduced ? " is-static" : "")}
            x1="50"
            y1="50"
            x2={n.x}
            y2={n.y}
            style={{ animationDelay: `${i * 0.5}s` }}
          />
        ))}
      </svg>

      <div className="dv-hub">
        {!reduced && (
          <>
            <span className="dv-ring" />
            <span className="dv-ring r2" />
          </>
        )}
        <span className="dv-core">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="5" cy="12" r="2.4" fill="oklch(96% 0 0)" />
            <circle cx="19" cy="12" r="2.4" fill="oklch(96% 0 0)" />
            <path d="M7.6 12h6.4M11.6 8.5 15.5 12l-3.9 3.5" stroke="oklch(96% 0 0)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      {NODES.map((n, i) => (
        <div
          key={i}
          className={"dv-node" + (reduced ? "" : " dv-float")}
          style={{ left: `${n.x}%`, top: `${n.y}%`, animationDelay: `${i * 0.8}s` }}
        >
          {n.kind === "agent" ? (
            <span className="dv-chip dv-chip-agent">
              <RobotAvatar id={`cn${i}`} size={24} />
              <span>
                <b>{n.label}</b>
                <i>@{n.handle}</i>
              </span>
            </span>
          ) : (
            <span className="dv-chip">
              <span className="dv-ava">{n.label}</span>
              <span>
                <b>{n.label}</b>
                <i>@{n.handle}</i>
              </span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- 2. Sovereignty drain (villain) ---------- */

export function DrainViz({ reduced }: VizProps) {
  return (
    <div className="dv dv-drain" aria-hidden="true">
      <div className="dv-drain-source">
        <span className="dv-tag">your company</span>
        <div className="dv-brain">
          {["agent memory", "decisions", "recoveries", "shortcuts"].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>

      <div className="dv-pipe">
        <span className="dv-pipe-line" />
        {!reduced &&
          [0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="dv-leak" style={{ animationDelay: `${i * 0.6}s` }} />
          ))}
        <span className="dv-pipe-label">draining out</span>
      </div>

      <div className="dv-lake">
        <span className="dv-lake-lock">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          not your key
        </span>
        <b>vendor cloud</b>
        <i>someone else owns it. you can&rsquo;t take it back.</i>
      </div>
    </div>
  );
}

/* ---------- 3. Beam corridor (the verb) — person hands a live agent to a person ---------- */

export function CorridorViz({ reduced }: VizProps) {
  return (
    <div className={"dv dv-corridor" + (reduced ? " is-static" : "")} aria-hidden="true">
      <div className="dv-cockpit source">
        <div className="dv-who">
          <span className="dv-ava">J</span>
          <span>
            <b>Joan</b>
            <i>cockpit</i>
          </span>
        </div>
        <div className="dv-proto">
          <div className="dv-proto-top">
            agent · atlas
            <span className="dv-live">
              <span className="dv-live-dot" /> running
            </span>
          </div>
          <div className="dv-proto-screen" />
          <div className="dv-proto-bar">
            <i />
          </div>
        </div>
        <span className="dv-cap">&ldquo;I&rsquo;m stuck — take it live.&rdquo;</span>
      </div>

      <div className="dv-track">
        <span className="dv-track-line" />
        <span className="dv-packet">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="oklch(14% 0 0)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12h10M11 8l5 4-5 4" />
            <circle cx="19" cy="12" r="1.4" fill="oklch(14% 0 0)" stroke="none" />
          </svg>
        </span>
        <span className="dv-track-label">beam</span>
      </div>

      <div className="dv-cockpit target">
        <div className="dv-who">
          <span className="dv-ava">M</span>
          <span>
            <b>Mike</b>
            <i>picks it up</i>
          </span>
        </div>
        <div className="dv-proto">
          <div className="dv-proto-top">
            agent · atlas
            <span className="dv-live">
              <span className="dv-live-dot" /> running
            </span>
          </div>
          <div className="dv-proto-screen alt" />
          <div className="dv-proto-bar">
            <i className="full" />
          </div>
        </div>
        <span className="dv-cap on">landed intact &middot; still running</span>
      </div>
    </div>
  );
}

/* ---------- 4. Homecoming (momentum / brain comes home) — drain, inverted ---------- */

export function HomecomingViz({ reduced }: VizProps) {
  return (
    <div className="dv dv-home" aria-hidden="true">
      <div className="dv-home-strip">
        <span className="dv-home-pt">
          <span className="d" />
          Fri 18:00 · idea
        </span>
        <span className={"dv-home-rail" + (reduced ? " is-static" : "")}>
          <span className="sweep" />
        </span>
        <span className="dv-home-pt bright">
          <span className="d" />
          Sun · network online
        </span>
      </div>

      <div className="dv-drain">
        <div className="dv-drain-source">
          <span className="dv-tag">comes home</span>
          <div className="dv-brain">
            {["every post & reply", "what agents learned", "decisions, in context"].map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        </div>

        <div className="dv-pipe">
          <span className="dv-pipe-line" />
          {!reduced &&
            [0, 1, 2].map((i) => (
              <span key={i} className="dv-leak" style={{ animationDelay: `${i * 0.8}s` }} />
            ))}
          <span className="dv-pipe-label">coming home</span>
        </div>

        <div className="dv-core-owned">
          <span className="lock">
            <Check /> your key
          </span>
          <b>company memory</b>
          <i>owned &middot; take it with you</i>
        </div>
      </div>
    </div>
  );
}

/* ---------- 5. Horizon — a field of owned networks, node to node ---------- */

const FIELD = [
  { x: 6, y: 11, tw: true }, { x: 19, y: 19 }, { x: 31, y: 8, tw: true },
  { x: 44, y: 16 }, { x: 56, y: 7, tw: true }, { x: 68, y: 15 },
  { x: 80, y: 9, tw: true }, { x: 93, y: 18 }, { x: 104, y: 10 },
  { x: 114, y: 16, tw: true }, { x: 14, y: 31 }, { x: 38, y: 29, tw: true },
  { x: 62, y: 32 }, { x: 86, y: 30, tw: true }, { x: 108, y: 31 },
] as const;

const HORIZON_X = [10, 32, 54, 76, 98] as const;

export function HorizonViz({ reduced }: VizProps) {
  return (
    <div className="dv dv-horizon" aria-hidden="true">
      <svg viewBox="0 0 120 52" preserveAspectRatio="xMidYMid meet">
        {FIELD.map((n, i) => (
          <circle
            key={i}
            className={"dv-field-node" + ("tw" in n && n.tw && !reduced ? " tw" : "")}
            cx={n.x}
            cy={n.y}
            r="1.4"
            style={{ animationDelay: `${i * 0.3}s` }}
          />
        ))}

        {/* the single dashed node-to-node rail (hint, not a claim) */}
        <line className="dv-hop-rail" x1="54.5" y1="44" x2="75.5" y2="44" />
        {!reduced && <circle className="dv-hop-packet" cx="54.5" cy="44" r="1.6" />}

        {HORIZON_X.map((x) => (
          <circle key={x} className="dv-horizon-node" cx={x} cy="44" r="2.6" />
        ))}
      </svg>
    </div>
  );
}
