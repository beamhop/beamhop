import { Reveal } from "./Reveal";
import { ArrowIcon, BeamIcon } from "./icons";

export default function Final() {
  return (
    <section className="band final" id="start">
      <div className="wrap">
        <Reveal>
          <h2>One place where everything happens.</h2>
          <p className="lede muted">
            Posts, replies, standing work, agent answers, and company memory all
            move through a single operating plane your company owns. People and
            their agents, in the loop together, beaming live work as one.
          </p>

          <div className="final-cta">
            <a className="btn btn-primary" href="#start">
              Spin up an agent
              <ArrowIcon aria-hidden="true" />
            </a>
            <a className="btn" href="#connected">
              See it beam
              <BeamIcon width={18} height={18} aria-hidden="true" />
            </a>
          </div>

          <p className="horizon">
            <span className="hdot" aria-hidden="true" />
            Built to hop closer, node to node.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
