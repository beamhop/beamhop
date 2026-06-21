import { Reveal } from "./Reveal";
import { LinkedInIcon, Logo } from "./icons";

type Member = {
  initials: string;
  grad: string;
  name: string;
  handle: string;
  role: string;
  bio: string;
  href: string;
};

/**
 * The two founders rendered as the first two nodes of the network they sell:
 * two cards bridged by a live beam. Copy leans only on claims the rest of the
 * site already makes (sovereign infra + real isolation, shipped in 72h) — the
 * individual bios are the slots to refine with each founder's real background.
 */
const TEAM: Member[] = [
  {
    initials: "HT",
    grad: "grad-m",
    name: "HT Sahin",
    handle: "@htx",
    role: "Co-founder · lead · ex-air-force pilot",
    bio: "Former air-force pilot, calm under load. As a hands-on engineering manager at the world's largest logistics operation, he built and led the project that saved ~£10M a year. Now an engineer at IKEA. He carries the thesis and the design partners.",
    href: "https://www.linkedin.com/in/htx/",
  },
  {
    initials: "AU",
    grad: "grad-a",
    name: "Ahmet Yasin Uslu",
    handle: "@ahmet-yasin-uslu",
    role: "Co-founder · engineering · $1B+ exit",
    bio: "Builder who was inside a previous company through its $1B+ exit, and has shipped inside some of the world's largest enterprises. He owns the sovereign substrate and the real isolation underneath — the reason a live agent beams between machines with no blast radius.",
    href: "https://www.linkedin.com/in/ahmet-yasin-uslu/",
  },
];

function MemberCard({ m }: { m: Member }) {
  return (
    <article className="member">
      <div className="member-top">
        <span className={"member-ava " + m.grad} aria-hidden="true">
          {m.initials}
        </span>
        <span className="member-id">
          <span className="member-name">{m.name}</span>
          <span className="member-handle">{m.handle}</span>
        </span>
      </div>
      <span className="member-role">{m.role}</span>
      <p className="member-bio">{m.bio}</p>
      <a
        className="member-link"
        href={m.href}
        target="_blank"
        rel="noreferrer"
        aria-label={`${m.name} on LinkedIn`}
      >
        <LinkedInIcon aria-hidden="true" />
        LinkedIn
      </a>
    </article>
  );
}

export default function Team() {
  return (
    <section className="band team" id="team">
      <div className="wrap">
        <Reveal className="band-head center">
          <span className="section-tag">The team</span>
          <h2>Two nodes. The part nobody can fake.</h2>
          <p>
            A former air-force pilot who took ~£10M a year out of the
            world&rsquo;s largest logistics operation, paired with a builder
            from a $1B+ exit. Together they shipped sovereign infra and real
            isolation in 72 hours &mdash; and locked the first design partner
            the same weekend.
          </p>
        </Reveal>

        <Reveal className="team-grid" delay={120}>
          <MemberCard m={TEAM[0]} />

          {/* the founders as the first two nodes of the network they sell */}
          <div className="team-bridge" aria-hidden="true">
            <span className="team-beam" />
            <span className="team-node">
              <Logo />
            </span>
          </div>

          <MemberCard m={TEAM[1]} />
        </Reveal>

        <Reveal className="team-proof" delay={220}>
          <span className="hdot" aria-hidden="true" />
          Operator and builder, locked together. Sovereign infra shipped in 72h.
        </Reveal>
      </div>
    </section>
  );
}
