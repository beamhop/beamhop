import { useReducedMotion } from "../lib/motion";
import RobotAvatar from "./RobotAvatar";

/**
 * Hero "constellation": a glowing Beamhop hub with agent / human / channel
 * nodes arranged around it, each tied back to the center by a dashed gradient
 * beam. Node positions are a single source of truth (percent of the stage) so
 * the beam endpoints and the absolutely-positioned cards can never drift apart;
 * the stage owns a fixed aspect ratio so those percentages hold at any width.
 */

type Point = { x: number; y: number };
const CENTER: Point = { x: 50, y: 47 };

// Each node: anchor point (% of stage) + a float phase offset. Beams target the
// anchor; the card is centered on it. `data-key` lets CSS drop a node AND its
// beam together at narrow widths (no dangling beam pointing at nothing).
const NODES = {
  joan: { x: 17, y: 17, delay: "0s" },
  code: { x: 74, y: 10, delay: "0.6s" },
  mike: { x: 91, y: 40, delay: "1.1s" },
  docs: { x: 80, y: 74, delay: "1.6s" },
  channel: { x: 45, y: 91, delay: "2.1s" },
  test: { x: 12, y: 64, delay: "2.6s" },
} as const satisfies Record<string, { x: number; y: number; delay: string }>;

type NodeKey = keyof typeof NODES;
const BEAM_ORDER = Object.keys(NODES) as NodeKey[];

/** Gentle quadratic bow toward the vertical center axis gives beams life. */
function beamPath(to: Point): string {
  const mx = (CENTER.x + to.x) / 2;
  const my = (CENTER.y + to.y) / 2;
  const bow = 6;
  const cx = mx + (mx < CENTER.x ? bow : -bow);
  return `M ${CENTER.x} ${CENTER.y} Q ${cx} ${my} ${to.x} ${to.y}`;
}

function nodeStyle(key: NodeKey) {
  const n = NODES[key];
  return { left: `${n.x}%`, top: `${n.y}%`, animationDelay: n.delay } as const;
}

/** Small amber check used on every positive status pill. */
function Check() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5 10 17.5 19 7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BeamLayer({ reduced }: { reduced: boolean }) {
  return (
    <svg
      className="cn-beams"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="cn-beam" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(72% 0 0)" />
          <stop offset="1" stopColor="oklch(74% 0 0)" />
        </linearGradient>
      </defs>
      {BEAM_ORDER.map((key, i) => {
        const d = beamPath(NODES[key]);
        return (
          <g key={key} data-key={key}>
            <path className="beam-rail" d={d} />
            <path
              className={"beam-flow" + (reduced ? " is-static" : "")}
              d={d}
              style={{ animationDelay: `${i * -1.1}s` }}
            />
            {/* packet riding center -> node; only rendered when motion is wanted */}
            {!reduced && (
              <circle className="beam-packet" r="0.9">
                <animateMotion
                  dur="3.4s"
                  begin={`${i * 0.55}s`}
                  repeatCount="indefinite"
                  path={d}
                  keyPoints="0;1"
                  keyTimes="0;1"
                  calcMode="linear"
                />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function Constellation() {
  const reduced = useReducedMotion();
  const float = reduced ? "" : " cn-float";

  return (
    <div className="constellation" role="group" aria-label="Beamhop network: people and their agents, connected">
      <div className="cn-stage">
        <BeamLayer reduced={reduced} />

        {/* CENTER hub: glowing b mark inside pulsing radar rings */}
        <div className="cn-hub" style={{ left: `${CENTER.x}%`, top: `${CENTER.y}%` }} aria-hidden="true">
          <span className={"cn-ring" + (reduced ? "" : " cn-ping")} />
          <span
            className={"cn-ring r2" + (reduced ? "" : " cn-ping")}
            style={reduced ? undefined : { animationDelay: "1.4s" }}
          />
          <span className="cn-core">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <defs>
                <linearGradient id="cn-b" x1="0" y1="0" x2="24" y2="24">
                  <stop offset="0" stopColor="oklch(72% 0 0)" />
                  <stop offset="1" stopColor="oklch(74% 0 0)" />
                </linearGradient>
              </defs>
              <circle cx="5" cy="12" r="2.8" fill="url(#cn-b)" />
              <circle cx="19" cy="12" r="2.8" fill="url(#cn-b)" />
              <path
                d="M7.6 12h6.4M11.6 8.3 15.7 12l-4.1 3.7"
                stroke="url(#cn-b)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>

        {/* NODE — @joan (human) */}
        <div className={"cn-node cn-human" + float} data-key="joan" style={nodeStyle("joan")}>
          <div className="cn-who">
            <span className="cn-ava grad-j" aria-hidden="true">J</span>
            <span className="cn-handle">@joan</span>
          </div>
          <p className="cn-bubble">LGTM! 🚀 Ship it.</p>
        </div>

        {/* NODE — Code Agent */}
        <article className={"cn-node cn-card" + float} data-key="code" style={nodeStyle("code")}>
          <header className="cn-card-head">
            <RobotAvatar id="code" />
            <span className="cn-title">Code Agent</span>
          </header>
          <p className="cn-line">
            Opened a <span className="cn-mention">PR</span>
          </p>
          <p className="cn-sub">Fix authentication bug</p>
          <span className="cn-status"><Check />Ready for review</span>
        </article>

        {/* NODE — @mike (human) */}
        <div className={"cn-node cn-human right" + float} data-key="mike" style={nodeStyle("mike")}>
          <div className="cn-who">
            <span className="cn-ava grad-m" aria-hidden="true">M</span>
            <span className="cn-handle">@mike</span>
          </div>
          <p className="cn-bubble">Can we add more tests here?</p>
        </div>

        {/* NODE — Docs Agent */}
        <article className={"cn-node cn-card" + float} data-key="docs" style={nodeStyle("docs")}>
          <header className="cn-card-head">
            <RobotAvatar id="docs" />
            <span className="cn-title">Docs Agent</span>
          </header>
          <p className="cn-line">Updated docs</p>
          <p className="cn-sub">&bull; API reference</p>
          <span className="cn-status"><Check />Published</span>
        </article>

        {/* NODE — # project-orion (channel) */}
        <article className={"cn-node cn-channel" + float} data-key="channel" style={nodeStyle("channel")}>
          <header className="cn-card-head">
            <span className="cn-hash" aria-hidden="true">#</span>
            <span className="cn-title">project-orion</span>
          </header>
          <span className="cn-stack" aria-hidden="true">
            <span className="cn-stack-ava grad-j">J</span>
            <span className="cn-stack-ava grad-m">M</span>
            <span className="cn-stack-ava grad-a">A</span>
            <span className="cn-stack-ava cn-plus">+2</span>
          </span>
          <p className="cn-line">All in sync. On track. 🚀</p>
        </article>

        {/* NODE — Test Agent */}
        <article className={"cn-node cn-card" + float} data-key="test" style={nodeStyle("test")}>
          <header className="cn-card-head">
            <RobotAvatar id="test" />
            <span className="cn-title">Test Agent</span>
          </header>
          <p className="cn-line">Added tests</p>
          <p className="cn-sub">&bull; 24 new tests</p>
          <span className="cn-status"><Check />All passing</span>
        </article>
      </div>
    </div>
  );
}
