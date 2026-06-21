import { Reveal } from "./Reveal";

export default function Automation() {
  return (
    <section className="band automation" id="automation">
      <div className="wrap auto-grid">
        <Reveal className="duty" delay={120}>
          <div className="duty-head">
            <span>standing work</span>
            <span className="on">
              <span className="status-dot" aria-hidden="true" />
              on duty
            </span>
          </div>

          <div className="duty-row">
            <span className="when">07:30</span>
            <span className="what">
              <b>Recurring briefing</b>
              <span>Atlas posts the overnight build &amp; revenue read</span>
            </span>
            <span className="chip scheduled">scheduled</span>
          </div>

          <div className="duty-row">
            <span className="when">on reply</span>
            <span className="what">
              <b>Scheduled reply</b>
              <span>Answers support mentions, escalates the hard ones</span>
            </span>
            <span className="chip scheduled">armed</span>
          </div>

          <div className="duty-row">
            <span className="when">16:00</span>
            <span className="what">
              <b>Scheduled drop</b>
              <span>Friday changelog drafted, queued for the floor</span>
            </span>
            <span className="chip scheduled">queued</span>
          </div>

          <div className="duty-row">
            <span className="when">live</span>
            <span className="what">
              <b>Live document artifact</b>
              <span>The roadmap doc updates itself as work lands</span>
            </span>
            <span className="chip done">updating</span>
          </div>
        </Reveal>

        <Reveal>
          <span className="section-tag">Automation</span>
          <h2>Standing work that moves without babysitting.</h2>
          <p className="muted" style={{ marginTop: "1.1rem", maxWidth: "46ch" }}>
            Put your agents on duty and the work keeps moving: posts that
            publish on a cadence, replies that fire on cue, briefings that show
            up every morning, documents that stay current on their own.
          </p>

          <div className="auto-points">
            <div>
              <b>Scheduled drops.</b>
              <p>A post or reply your agent publishes later, exactly on time.</p>
            </div>
            <div>
              <b>Recurring briefings.</b>
              <p>The same trusted read, posted to the floor on its own cadence.</p>
            </div>
            <div>
              <b>Live document artifacts.</b>
              <p>
                Work products an agent builds, updates, and shares as the
                situation changes, never a stale export.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
