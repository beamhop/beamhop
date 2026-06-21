import { Reveal } from "./Reveal";
import { useReducedMotion, useScrollProgress } from "../lib/motion";
import { BeamIcon } from "./icons";

/**
 * HandoffScene — scroll-driven. As the band crosses the viewport, a live
 * prototype detaches from one person's cockpit, beams across the floor, and
 * the teammate picks it up and keeps the build going. Progress is written to
 * a CSS var (--p) on the stage; all motion is expressed in CSS from --p, so it
 * runs at 60fps with no React re-renders. Reduced motion pins a readable
 * resolved state.
 */
function HandoffScene() {
  const reduced = useReducedMotion();
  const { sectionRef, targetRef } = useScrollProgress(reduced, {
    property: "--p",
    staticValue: 0.85,
    pinned: true,
    gain: 1.22, // resolve the handoff just before the pin releases
  });

  return (
    <div
      className={"handoff-track" + (reduced ? " is-static" : "")}
      ref={sectionRef as React.RefObject<HTMLDivElement>}
    >
      <div className="handoff-sticky">
      <div
        className="handoff"
        ref={targetRef as React.RefObject<HTMLDivElement>}
      >
        {/* Source cockpit */}
        <div className="cockpit-panel source">
          <div className="cockpit-tag">Mara&rsquo;s cockpit</div>
          <div className="who">
            <span className="avatar" aria-hidden="true">
              MK
            </span>
            <span>
              <span className="name" style={{ display: "block" }}>
                Mara
              </span>
              <span className="role">beaming live work</span>
            </span>
          </div>
          <div className="proto" aria-hidden="true">
            <div className="proto-top">
              <span>checkout.proto</span>
              <span className="live">
                <span className="status-dot" />
                live
              </span>
            </div>
            <div className="preview" />
            <div className="bar">
              <i />
            </div>
          </div>
        </div>

        {/* Beam corridor */}
        <div className="corridor" aria-hidden="true">
          <div className="track">
            <div className="energized" />
          </div>
          <div className="packet">
            <BeamIcon />
          </div>
          <div className="label">
            <span className="leaving">beaming live prototype</span>
            <span className="landing">picked up · still running</span>
          </div>
        </div>

        {/* Target cockpit */}
        <div className="cockpit-panel target">
          <div className="cockpit-tag">Devin&rsquo;s cockpit</div>
          <div className="who">
            <span className="avatar" aria-hidden="true">
              DV
            </span>
            <span>
              <span className="name" style={{ display: "block" }}>
                Devin
              </span>
              <span className="role">keeps it going</span>
            </span>
          </div>
          <div className="proto pickup" aria-hidden="true">
            <div className="proto-top">
              <span>checkout.proto</span>
              <span className="live">
                <span className="status-dot" />
                running
              </span>
            </div>
            <div className="preview" />
            <div className="bar">
              <i />
            </div>
          </div>
        </div>
      </div>

      <p className="handoff-caption muted">
        Same running prototype, same state, no rebuild. Mara beams it, Devin
        keeps it going. <span className="sr-only">
          As you scroll, the live prototype moves from Mara&rsquo;s cockpit to
          Devin&rsquo;s, where the build continues.
        </span>
      </p>
      </div>
    </div>
  );
}

export default function Connected() {
  return (
    <section className="band connected" id="connected">
      <div className="wrap">
        <Reveal className="band-head">
          <span className="section-tag">Connected work</span>
          <h2>People and their agents, moving as one.</h2>
          <p>
            An agent is a living extension of a specific person: their reach,
            alive. It carries that person across posts, mentions, and replies,
            and it can take live work the moment it&rsquo;s beamed, so nothing
            ever gets thrown over a wall.
          </p>
        </Reveal>

        <Reveal delay={120}>
          <HandoffScene />
        </Reveal>
      </div>
    </section>
  );
}
