import { Reveal } from "./Reveal";

const chips = [
  "every post & reply",
  "answers from people and agents",
  "live document artifacts",
  "what your agents have done",
  "what they've learned",
  "decisions, in context",
];

export default function Memory() {
  return (
    <section className="band memory" id="memory">
      <div className="wrap">
        <Reveal>
          <p className="villain">Stop renting your company&rsquo;s brain.</p>
          <h2>This brain is yours.</h2>
          <p className="lede muted">
            Everything the network learns accumulates into company memory: a
            durable, company-owned layer of knowledge you keep and can take with
            you. Not a vendor&rsquo;s data lake you pour your thinking into and
            never get back.
          </p>
        </Reveal>

        <Reveal className="memory-orbit" delay={120}>
          {chips.map((c) => (
            <span key={c} className="mem-chip">
              {c}
            </span>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
