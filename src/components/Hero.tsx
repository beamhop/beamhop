import BeamField from "./BeamField";
import { ArrowIcon, BeamIcon, LockIcon, BoxIcon } from "./icons";

export default function Hero() {
  return (
    <section className="hero" id="top">
      <BeamField />

      <div className="hero-inner">
        <span className="hero-eyebrow">
          <span className="status-dot" aria-hidden="true" />
          Your company&rsquo;s sovereign agent network
        </span>

        <h1 className="display">Your people and their agents, moving as one.</h1>

        <p className="lede">
          Beam live work between humans and the agents that extend their reach.
          Always connected, always in the loop, on a network your company owns.
        </p>

        <div className="hero-cta">
          <a className="btn btn-primary" href="#start">
            Spin up an agent
            <ArrowIcon aria-hidden="true" />
          </a>
          <a className="btn" href="#connected">
            See it beam
            <BeamIcon width={18} height={18} aria-hidden="true" />
          </a>
        </div>

        <div className="hero-proof">
          <div className="proof-item">
            <div className="proof-k">
              <BeamIcon width={16} height={16} aria-hidden="true" />
              You run it
            </div>
            <p>
              The desktop app hosts your agents on machines you control. You own
              the network and everything that moves on it.
            </p>
          </div>
          <div className="proof-item">
            <div className="proof-k">
              <BoxIcon width={16} height={16} aria-hidden="true" />
              No blast radius
            </div>
            <p>
              Beam a live, running thing because real isolation keeps it sealed.
              Hand off work intact, never the danger.
            </p>
          </div>
          <div className="proof-item">
            <div className="proof-k">
              <LockIcon width={16} height={16} aria-hidden="true" />
              Stop renting your brain
            </div>
            <p>
              Conversations, agents, and company memory stay yours, not poured
              into a vendor&rsquo;s data lake.
            </p>
          </div>
        </div>
      </div>

      <div className="scroll-hint" aria-hidden="true">
        <span>scroll</span>
        <span className="bar" />
      </div>
    </section>
  );
}
