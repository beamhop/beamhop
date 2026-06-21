import { Reveal } from "./Reveal";
import { KeyIcon, BoxIcon, ShieldIcon, LockIcon } from "./icons";

export default function Security() {
  return (
    <section className="band security" id="security">
      <div className="wrap security-grid">
        <Reveal>
          <span className="section-tag">Security</span>
          <h2>
            Beam <span className="accent">without</span> the blast radius.
          </h2>
          <p className="muted" style={{ marginTop: "1.1rem", maxWidth: "46ch" }}>
            You can hand someone a live, running thing because it never runs
            loose. Real isolation is what makes beaming safe, and what makes the
            network yours to trust.
          </p>

          <div className="security-points">
            <div className="spoint">
              <span className="ico" aria-hidden="true">
                <ShieldIcon />
              </span>
              <div>
                <h3>Company-owned control</h3>
                <p>
                  Agent identities, conversations, and execution boundaries are
                  governed by you, today, not by a vendor holding the keys.
                </p>
              </div>
            </div>

            <div className="spoint">
              <span className="ico" aria-hidden="true">
                <KeyIcon />
              </span>
              <div>
                <h3>Encrypted channels</h3>
                <p>
                  Work moves over private, encrypted channels with portable
                  agent identities. The network is closed to everyone outside it.
                </p>
              </div>
            </div>

            <div className="spoint">
              <span className="ico" aria-hidden="true">
                <BoxIcon />
              </span>
              <div>
                <h3>Real isolation</h3>
                <p>
                  Every agent runs inside a genuine sandboxed boundary. Beam the
                  running work; the danger stays sealed in its cell.
                </p>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal className="iso" delay={120}>
          <div className="iso-host">
            <span>host you control</span>
            <span>sealed runs</span>
          </div>
          <div className="iso-cells">
            <div className="iso-cell">
              <div className="cell-label">
                <BoxIcon width={16} height={16} aria-hidden="true" />
                atlas / run-127
              </div>
              <div className="run" aria-hidden="true" />
              <span className="sealed">
                <LockIcon width={13} height={13} aria-hidden="true" />
                sealed
              </span>
            </div>
            <div className="iso-cell">
              <div className="cell-label">
                <BoxIcon width={16} height={16} aria-hidden="true" />
                prototype / checkout
              </div>
              <div className="run" aria-hidden="true" />
              <span className="sealed">
                <LockIcon width={13} height={13} aria-hidden="true" />
                sealed
              </span>
            </div>
          </div>
          <p className="iso-note">
            <ShieldIcon width={16} height={16} aria-hidden="true" />
            Each run is boxed off from the host and from every other run.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
