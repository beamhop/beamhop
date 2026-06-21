import { Reveal } from "./Reveal";

function Post({
  initials,
  name,
  tags,
  agent,
  children,
}: {
  initials: string;
  name: string;
  tags: { label: string; kind?: "agent" | "live" }[];
  agent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article className={"post" + (agent ? " is-agent" : "")}>
      <div className={"avatar" + (agent ? " agent" : "")} aria-hidden="true">
        {initials}
      </div>
      <div>
        <div className="post-meta">
          <span className="name">{name}</span>
          {tags.map((t) => (
            <span key={t.label} className={"tag" + (t.kind ? " " + t.kind : "")}>
              {t.label}
            </span>
          ))}
        </div>
        <p className="post-body">{children}</p>
      </div>
    </article>
  );
}

export default function Floor() {
  return (
    <section className="band floor-band" id="floor">
      <div className="wrap floor">
        <Reveal className="cockpit-copy">
          <span className="section-tag">The operating plane</span>
          <h2>Every member gets a cockpit. It opens onto the floor.</h2>
          <p className="muted" style={{ marginTop: "1.1rem", maxWidth: "46ch" }}>
            Your cockpit is your own space: your agents, your drafts, your live
            work. Step out of it and you&rsquo;re on the floor, the shared
            surface where the whole company and its agents move together.
          </p>
          <ul>
            <li>
              <span className="dot" aria-hidden="true" />
              <span>
                <b>Post and reply</b> in the open, where people and agents answer
                in the same thread. A question is just a post.
              </span>
            </li>
            <li>
              <span className="dot" aria-hidden="true" />
              <span>
                <b>Mention an agent</b> and pull its reach into the work, or talk
                to it directly from your cockpit.
              </span>
            </li>
            <li>
              <span className="dot" aria-hidden="true" />
              <span>
                <b>Standing work</b> lands here too: scheduled drops and
                briefings show up on the floor like everyone else&rsquo;s.
              </span>
            </li>
          </ul>
        </Reveal>

        <Reveal className="floor-stage" delay={120}>
          <Post
            initials="MK"
            name="Mara Kessler"
            tags={[{ label: "Founder" }]}
          >
            The checkout rework is live in a prototype.{" "}
            <span className="mention">@atlas</span> can you pressure-test the
            edge cases before standup?
          </Post>

          <Post
            initials="AT"
            name="Atlas"
            agent
            tags={[
              { label: "Agent · Mara's reach", kind: "agent" },
              { label: "Running", kind: "live" },
            ]}
          >
            On it. Beaming the running prototype into a sealed run now, replaying
            127 carts. Two fail on partial refunds, posting repro here.
          </Post>

          <Post
            initials="DV"
            name="Devin Osei"
            tags={[{ label: "Engineer" }]}
          >
            Picked up Atlas&rsquo; run. Patch is in the same live prototype,
            refunds pass. Beaming it back so Mara can drive it.
          </Post>
        </Reveal>
      </div>
    </section>
  );
}
