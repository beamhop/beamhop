# Design

## Theme

Beamhop's public site translates the existing desktop "ground-station console"
into a brand surface for a company-wide agent network. The scene is an evening
operations room: people are watching the company wake up into a secure, shared
human-AI mesh. That pushes the site toward a dark committed palette with
electric violet beams and amber live-state moments.

## Color

Use OKLCH tokens while preserving the existing Beamhop identity:

- `--void`: near-black violet background
- `--field`: deep ionosphere surface
- `--panel`: raised operational surface
- `--line`: quiet violet divider
- `--beam-1`: electric violet
- `--beam-2`: hot magenta
- `--carrier`: amber live signal
- `--text`: high-contrast off-white
- `--muted`: lavender gray for secondary text

The beam gradient is a material, not text decoration. Use it for light, motion,
fields, and action backgrounds. Reserve amber for live, scheduled, or active
agent moments.

## Typography

Display type keeps the existing Space Grotesk / geometric-console direction when
available, with system fallbacks. Body type uses a clean UI sans stack. Data and
interface fragments use a mono stack sparingly for machine-truthful labels.

Headlines should be short, heavy, and declarative. No gradient text. No tiny
uppercase eyebrow repeated above every section.

## Layout

The site is a long-scroll brand page with one dominant idea per section:

- Hero: connection-led. Canonical headline: "Your people and their agents,
  moving as one." Sub: "Beam live work between humans and the agents that extend
  their reach. Always connected, always in the loop, on a network your company
  owns." Lead action: a founder beams a live prototype (or a stuck, running
  agent) to a teammate who picks it up and keeps going. The 5-second aha is
  beaming live work between people and agents, not a static handoff. Sovereignty
  proof: you run it, the desktop app hosts the agents on infra you control.
  Security proof: you can beam a live, running thing because real isolation
  means no blast radius. Villain: stop renting your company's brain. Connection
  is the spear; sovereignty is the backing fact; beam is the proof verb.
- Operating plane: people, agents, posts, replies, and scheduled work converge
- Security: company-owned control, encrypted channels, and real isolation
  ("beam without the blast radius")
- Automation: scheduled drops, replies, and live document artifacts
- Connected work: people and their agents move as one; agents extend a person's
  reach across posts, mentions, replies, and beamed live work
- Final claim: one place where everything happens (close on the single P2P
  horizon line)

Use full-width bands, large asymmetric compositions, and live network imagery.
Cards are allowed only for individual post/message artifacts, not as the page's
default scaffold.

## Motion

Motion should feel like signals acquiring lock across a private network:

- Hero canvas: slow beam field with pulses between company participants and
  agents
- Product artifacts: subtle drift, scan, and reply handoff
- Scroll: sections sharpen into view without hiding content
- Reduced motion: stop continuous movement, keep the static field visible

## Public Copy Guardrail

Never expose implementation substrate terms in public-facing copy. Say "private
network", "encrypted channels", "portable agent identities", and "company-owned
control" instead.

## Pillars

Security, automation, and connected work are the public pillars ("collaboration"
is retired as too generic). Security should include real isolation and sandboxed
execution, framed as "beam without the blast radius". Automation should feel like
work moving without babysitting. Connected work should make people and their
agents feel like they move as one: agents extend a person's reach, always in the
loop, never free-standing replacements.

## Future Vision

Hint at a peer-to-peer future as a horizon line, not as a shipped feature. The
site can use language like "built toward a more direct company network" or "the
network can move closer to where the work lives", but it must not imply P2P is
available today.
