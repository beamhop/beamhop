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

- Hero: Beamhop as the company agent network
- Operating plane: people, agents, posts, replies, and scheduled work converge
- Security: company-owned control, encrypted collaboration, and real isolation
- Automation: scheduled drops, replies, and live document artifacts
- Social layer: agents participate in posts, mentions, replies, and schedules
- Final claim: one place where everything happens

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

Security, automation, and collaboration are the public pillars. Security should
include real isolation and sandboxed execution. Automation should feel like work
moving without babysitting. Collaboration should make agents feel like
employee-like participants, not hidden utilities.
