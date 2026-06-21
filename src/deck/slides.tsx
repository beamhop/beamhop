import type { ComponentType } from "react";
import { BeamIcon, BoxIcon, PulseIcon } from "../components/icons";
import {
  ConstellationViz,
  CorridorViz,
  DrainViz,
  HomecomingViz,
  HorizonViz,
} from "./visuals";

export type SlideProps = { active: boolean; reduced: boolean };

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="s-bullets">
      {items.map((t) => (
        <li key={t}>
          <span className="dot" aria-hidden="true" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- 01 · Hook — the un-fakeable cold open ---------- */

function Hook({ reduced }: SlideProps) {
  return (
    <div className="s-wrap wide s-center">
      <span className="s-eyebrow">
        <span className="status-dot" aria-hidden="true" />
        beamhop &middot; one live workspace for people and agents
      </span>
      <h2 className="s-title">Watch this work change hands.</h2>
      <p className="s-sub" style={{ marginInline: "auto" }}>
        A real task, caught mid-flight. We beam it from a person to an agent &mdash;
        then on to the next pair of hands &mdash; live, in this room. It never restarts.
      </p>

      <div className="s-band">
        <CorridorViz reduced={reduced} />
      </div>

      <div className="s-proofrow">
        <div className="s-proof">
          <div className="k">
            <BoxIcon width={16} height={16} aria-hidden="true" />
            Lands intact
          </div>
          <p>The whole live state moves &mdash; no restart, no rebuild, no copy-paste, no lossy handoff.</p>
        </div>
        <div className="s-proof">
          <div className="k">
            <BeamIcon width={16} height={16} aria-hidden="true" />
            Beams any direction
          </div>
          <p>Person to agent, agent to person, person to person &mdash; one identical motion, every time.</p>
        </div>
        <div className="s-proof">
          <div className="k">
            <PulseIcon width={16} height={16} aria-hidden="true" />
            Resumes, not restarts
          </div>
          <p>Whoever catches it continues from the exact moment it left &mdash; never from zero.</p>
        </div>
      </div>
    </div>
  );
}

/* ---------- 02 · Villain — captive memory ---------- */

function Villain({ reduced }: SlideProps) {
  return (
    <div className="s-wrap wide">
      <div className="s-split">
        <div className="s-copy">
          <span className="s-readout">// 02 · captive memory — no take-backs</span>
          <h2 className="s-title">Stop renting your company&rsquo;s brain.</h2>
          <p className="s-sub">The lock-in isn&rsquo;t your data. It&rsquo;s your agents&rsquo; memory.</p>
          <Bullets
            items={[
              "Every decision, recovery, and shortcut your agents learn lives in a US vendor's cloud. Their format, their terms.",
              "GDPR was about your customers' data. This is about your company's mind.",
              "Stuck today? The best you can do is throw work over a wall; a file, an export, dead state.",
              "When the contract ends, the brain doesn't come home.",
            ]}
          />
        </div>
        <div className="s-visual">
          <DrainViz reduced={reduced} />
        </div>
      </div>
    </div>
  );
}

/* ---------- 03 · Product — the verb on a network you own ---------- */

function Product({ reduced }: SlideProps) {
  return (
    <div className="s-wrap wide">
      <div className="s-split visual-left">
        <div className="s-copy">
          <span className="s-readout">// 03 · beam · hop · owned</span>
          <h2 className="s-title">Your people and their agents, moving as one.</h2>
          <p className="s-sub">Beam live work between them, on a network your company owns.</p>
          <Bullets
            items={[
              "Beam a running agent, a working environment, or a live prototype to the next node, a teammate, an agent, or a machine you control. It lands running.",
              "Beam without the blast radius: every run sits in a real, sealed cell. The work moves; the danger never does.",
              "Every agent is a living extension of one person's reach — it amplifies your team, never replaces it, never out of the loop.",
            ]}
          />
        </div>
        <div className="s-visual">
          <ConstellationViz reduced={reduced} />
        </div>
      </div>
    </div>
  );
}

/* ---------- 04 · Momentum — the brain comes home ---------- */

function Momentum({ reduced }: SlideProps) {
  return (
    <div className="s-wrap wide">
      <div className="s-split">
        <div className="s-copy">
          <span className="s-readout">// 04 · the proof — fri → sun</span>
          <h2 className="s-title">Friday it was a thesis. Tonight you can beam on it.</h2>
          <p className="s-sub">
            The hard part &mdash; sovereign infra plus real isolation &mdash; is the
            part we shipped first. It&rsquo;s the part nobody can fake.
          </p>
          <Bullets
            items={[
              "72 hours: a live agent network, a real sealed run you can probe, work beaming between humans and agents on infra we control.",
              "First sovereign-infra design partner secured this weekend, a company that owns its network instead of renting its brain.",
            ]}
          />

          <div className="s-team">
            <span className="s-team-label">// who&rsquo;s building it</span>
            <div className="s-team-grid">
              <div className="s-team-one">
                <b>HT Sahin</b>
                <span>
                  Air-force pilot. Built the ~&pound;10M/yr project at the
                  world&rsquo;s most iconic fashion brands. Now at the largest logistics operation of the planet, IKEA.
                </span>
              </div>
              <div className="s-team-one">
                <b>Ahmet Yasin Uslu</b>
                <span>
                  Built inside the world&rsquo;s largest enterprises. Prior team
                  shipped a $1B+ exit.
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="s-visual">
          <HomecomingViz reduced={reduced} />
        </div>
      </div>
    </div>
  );
}

/* ---------- 05 · Vision — the category, and the horizon ---------- */

function Vision({ reduced }: SlideProps) {
  return (
    <div className="s-wrap wide s-center s-vision">
      <span className="s-readout">// 05 · the horizon</span>
      <h2 className="s-title">Whoever owns the agent network owns the next platform.</h2>
      <p className="s-sub" style={{ marginInline: "auto" }}>
        Every company will run one. The only question is whether they rent it from a
        US cloud &mdash; or own it. We&rsquo;re building the sovereign default.
      </p>

      <div className="s-band">
        <HorizonViz reduced={reduced} />
      </div>

      <p className="s-mantra">
        Priced per seat. Stickier with every memory it keeps.
      </p>
      <p className="s-p2p">
        <span className="hdot" aria-hidden="true" />
        Built to hop closer, node to node.
      </p>
      <p className="s-footnote">// network online</p>
    </div>
  );
}

export const SLIDES: ComponentType<SlideProps>[] = [
  Hook,
  Villain,
  Product,
  Momentum,
  Vision,
];
