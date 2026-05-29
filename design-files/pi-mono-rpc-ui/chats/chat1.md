# Pi-Mono RPC Controller

_Started 2026-05-28 17:27 UTC_

---

## User

I want you to research pi-mono coding agent's rpc mode. Get the features and apis it supports and build a user frienly modern visually appealing user interface to control pi-mono via a desktop application

## Assistant

_[tool: questions_v2]_

I'll research pi-mono's RPC mode first to understand its actual features and APIs.

_[tool: web_search]_

_[tool: web_search]_

Let me fetch the full RPC documentation to get the exact commands and events.

_[tool: web_fetch]_

I'll fetch from one of the URLs returned in search results.

_[tool: web_fetch]_

I've now got the full picture of pi-mono's RPC mode. It's a JSON-over-stdio protocol with a rich surface:

- **Prompting & control:** `prompt`, `steer`, `follow_up`, `abort`, with steering/follow-up queue modes
- **Streaming events:** live `message_update` deltas (text/thinking/toolcall), `tool_execution_start/update/end`, turn lifecycle
- **Sessions:** fork, clone, switch, new, name, a history/branch tree, export to HTML
- **Models & reasoning:** model picker/cycle, thinking levels (off→xhigh)
- **Context:** token usage, cost tracking, context-window %, manual + auto compaction, auto-retry
- **Bash** execution out-of-band, plus an **extension UI protocol** (select/confirm/input/notify/status/widgets)

That's plenty to design a real control surface around. Before I start building, a few questions so I design the *right* thing rather than guessing — there's no existing design system here, so this will be an original design.

## User

Questions timed out; go with defaults

## Assistant

_[tool: update_todos]_

Going with strong defaults: a **pro developer-tool aesthetic** — dark, dense, monospace-forward with terminal DNA, macOS window chrome, a blue accent (green for tool/success states), three-pane layout, and a **fully interactive prototype that simulates a live RPC event stream**. I'll make key choices tweakable.

Let me set up the project.

_[tool: copy_starter_component]_

_[tool: copy_starter_component]_

_[tool: delete_file]_

I'll build custom window chrome for full control over the dark dev-tool aesthetic (the starter is a light "Liquid Glass" style that'd fight the look). Removing it and keeping the tweaks panel.

_[tool: write_file]_

Now the design tokens. Dark, dense, terminal DNA with Geist + Geist Mono.

_[tool: write_file]_

Now the simulation engine and data — this is what makes it feel like a live RPC stream.

_[tool: write_file]_

Now the runner engine that plays scenarios out as a timed event stream.

_[tool: write_file]_

Now the chat transcript — message rendering with thinking blocks, tool calls, and streaming.

_[tool: write_file]_

Now the composer with model/thinking pickers and streaming controls.

_[tool: write_file]_

Now the left sessions rail and branch tree.

_[tool: write_file]_

Now the inspector — context ring, token/cost meters, queue, session controls, and a live RPC event ticker.

_[tool: write_file]_

Extension UI dialog overlay (confirm/select prompts from the agent).

_[tool: write_file]_

Now the main app that wires it all together, plus window chrome and tweaks.

_[tool: write_file]_

Now the component styles — the big one tying all the visuals together.

_[tool: read_file]_

Assembling. Let me check the tweaks panel's top-level declarations to avoid global `const` collisions with app.jsx.

_[tool: grep]_

_[tool: grep]_

_[tool: write_file]_

Now the entry HTML.Let me check it loads cleanly in my own iframe before handing off.

_[tool: show_html]_

_[tool: show_html]_

_[tool: get_webview_logs]_

_[tool: save_screenshot]_

Clean load. Let me screenshot to see the result.

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: save_screenshot]_

Strong first render. But only the first user message shows — the two seed assistant turns aren't appearing. Let me scroll the transcript to check.

_[tool: view_image]_

_[tool: save_screenshot]_

The assistant turns genuinely aren't rendering. Let me probe the DOM by surfacing counts into a visible element.

_[tool: view_image]_

_[tool: save_screenshot]_

The assistant rows are in the DOM (2 rows, 4 tool calls) but render with no visible height. Let me probe their geometry.

_[tool: view_image]_

_[tool: save_screenshot]_

Row is laid out (634×195) but painting invisibly. Let me get its viewport position and the transcript scroll state.

_[tool: view_image]_

_[tool: save_screenshot]_

Need the asst row's opacity — the placeholder got cut. Shorter probe.

_[tool: view_image]_

_[tool: str_replace_edit]_

Found it — the assistant rows have **opacity 0**; the `fadeup` entrance animation is stuck at its start frame. I'll remove that fragile inline animation (the streaming typewriter already gives a nice reveal).

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: show_html]_

The page didn't reload (placeholder still shows the old probe). Let me reload it.

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: save_screenshot]_

The full transcript renders beautifully now — thinking blocks, tool calls with diff badges, inline code, turn costs. Let me test the live streaming flow (which triggers the extension-UI confirm dialog).

_[tool: view_image]_

_[tool: save_screenshot]_

Streaming works — run bar with steer/follow-up + Abort, live event ticker. Let me capture the confirm dialog and the new streamed content (scrolling to bottom).

_[tool: view_image]_

_[tool: get_webview_logs]_

The stream looks stuck after `agent_start` and the new message isn't visible. Let me check the console for a runtime error.

_[tool: save_screenshot]_

No errors. Let me probe the live DOM during streaming to see what's actually in the transcript.

_[tool: view_image]_

_[tool: save_screenshot]_

5 rows exist and we're scrolled to the bottom, but the 2 new rows aren't visible. Let me inspect rows 4 and 5 directly.

_[tool: view_image]_

_[tool: save_screenshot]_

Let me outline every row to see exactly where they paint versus where layout says they are.

_[tool: view_image]_

_[tool: save_screenshot]_

Let me read the actual event list and the streaming message's content atomically.

_[tool: view_image]_

_[tool: str_replace_edit]_

Good — content IS rendering and events ARE progressing (`agent_start, turn_start, message_start, message_update`). The only problem is the autoscroll isn't reliably pinning to the bottom (the effect reads a stale `scrollHeight` before layout). Let me fix it with rAF.

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: save_screenshot]_

Still not pinning. Let me capture with an explicit scroll-to-bottom right before the capture to confirm the content renders correctly when scrolled.

_[tool: view_image]_

_[tool: save_screenshot]_

The dialog scrim is fading in (screen dimming, stats updated to 5 tool calls). Let me capture the fully-rendered dialog.

_[tool: view_image]_

_[tool: str_replace_edit]_

Root cause found: the preview iframe throttles CSS animations when backgrounded, freezing `fadeup` at its first frame — which had `opacity: 0`. That's why animated-in elements (asst rows, and now the dialog) render invisible. I'll make the entrance animation opacity-safe (transform-only) so frozen = fully visible.

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: save_screenshot]_

Let me probe the live state comprehensively — events, dialog presence, scroll, and the last message text.

_[tool: view_image]_

_[tool: str_replace_edit]_

The streaming logic is sound — the symptoms (frozen animations, crawling timers, no autoscroll) are all **background-tab throttling** in my preview iframe (Chrome clamps `setTimeout`/rAF/CSS animations when a tab isn't focused). After 9.5s only 4 events fired (~1/sec = the 1s background clamp). For a real foreground user it runs at full speed.

Let me harden autoscroll to be synchronous (works regardless of throttle), then verify in the user's **foreground** tab where timers run normally.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: done]_

Now let me surface it to the user's foreground tab and verify there (where timers aren't throttled).

_[tool: screenshot_user_view]_

_[tool: eval_js_user_view]_

Foreground view looks great — full transcript renders, Tweaks panel works (accent swatches, density, scale). Now let me test live streaming in the foreground where timers run normally.

_[tool: sleep]_

_[tool: screenshot_user_view]_

_[tool: eval_js_user_view]_

Streaming started in foreground. Let me scroll to the bottom and check the event count to confirm it's running at full speed now.

_[tool: write_file]_

Even the user's pane is throttled (4 events in 4s) — the preview iframes clamp `setTimeout` to ~1s, and my char-by-char typewriter fires dozens of sequential timeouts, so a turn would take 30s+. I'll rewrite the engine to use **rAF with delta-time** instead: it completes in the target wall-clock time regardless of frame rate (smooth at 60fps when focused, a couple of big catch-up jumps when throttled — but fast either way).

_[tool: show_html]_

Let me reload and re-test the streaming speed in my iframe (rAF-based should now complete even when throttled).

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: str_replace_edit]_

rAF is fully **paused** in my backgrounded iframe (worse than `setTimeout`, which at least fires at the 1s clamp) — so it hung at the first wait. The fix: keep `setTimeout` (it always fires) but drive the typewriter with **delta-time** so it completes in 1–2 ticks even when each tick is clamped to 1s, instead of dozens of sequential 18ms timers.

_[tool: str_replace_edit]_

Need to fix the remaining `nextFrame()` reference in `addBlock`.

_[tool: grep]_

Good. Let me reload and test streaming end-to-end (the redis scenario reaches the confirm dialog).

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: save_screenshot]_

The extension-UI confirm dialog renders perfectly, and the stream reached it in ~8s even throttled. Let me approve it and confirm the scenario completes.

_[tool: view_image]_

_[tool: snip]_

The full flow works end-to-end now — streaming, the extension-UI confirm dialog, approval, scenario completion, and live cost/token/context updates (16 msgs, $0.4160, 5 tool calls, 32% ctx). The delta-time engine completes even under heavy throttling.

Let me clean up context from the debugging iterations, then do a final foreground check.

_[tool: done]_

_[tool: eval_js_user_view]_

Let me do a final foreground spot-check — verify the model picker popover and a clean streaming run in the user's pane.

_[tool: eval_js_user_view]_

State updates are async — let me click and screenshot to see the popover.

_[tool: screenshot_user_view]_

_[tool: eval_js_user_view]_

That was two toggles (open then closed). Let me open it once cleanly.

_[tool: screenshot_user_view]_

_[tool: done]_

Model picker works perfectly — all 5 providers with context windows, pricing, provider dots, reasoning pips, and the `cycle_model · ⌘M` hint. Everything's functioning: streaming, the extension-UI dialog, model/thinking pickers, live cost/context meters, tweaks.

Let me reset to a clean state for the user and hand off to the verifier.

_[tool: fork_verifier_agent]_

I researched **pi-mono's RPC mode** (the `earendil-works/pi` coding agent) and built a polished desktop control app around its real protocol.

**What it covers from the actual RPC API:**
- **Streaming chat** with the real event lifecycle — `agent_start → turn_start → message_update` deltas (thinking / text / toolcall) → `tool_execution_start/update/end` → `agent_end`, all visible in a live event ticker
- **Tool calls** rendered inline (`read`, `grep`, `write`, `edit`, `bash`) with diff badges, streaming output, and running/done/error states
- **Steering & follow-up queue** (`steer` / `follow_up` with mode toggles) plus **abort** (Esc), shown in the composer when the agent is running
- **Extension UI protocol** — the `extension_ui_request` confirm dialog (e.g. approving `npm install`) blocks the stream until you answer, exactly per spec
- **Model & thinking control** — `set_model` / `cycle_model` picker (5 providers with context windows + pricing), `set_thinking_level` (off→xhigh)
- **Context & cost** — live context-window ring, token breakdown (input/output/cache), cost, `compact`, `set_auto_compaction`, `set_auto_retry`
- **Sessions** — history rail grouped by working dir, branch/fork tree, `fork` / `clone` / `switch` / `export_html`

**Design:** dark dev-tool aesthetic, macOS window chrome, Geist + Geist Mono, blue accent (green for tool/success). Built as a fully interactive prototype that simulates a real RPC stream. **Tweaks** (toolbar) let you change accent, density, UI scale, toggle the RPC inspector, and go mono-everywhere.

Try it: type a message and hit Send to watch a turn stream in, approve the install dialog, open the model picker, or toggle Tweaks.

One note: the streaming uses real wall-clock timing, so it's smoothest when the preview tab is focused (background tabs throttle timers — the engine still completes, just in a couple of catch-up jumps). Want me to add more scenarios, a steering-in-flight demo, or a session-switch flow?

## User

add support for / commands. I also want a command palette for everything we support in this UI

## Assistant

_[tool: snip]_

I'll add slash-command autocomplete in the composer and a global ⌘K command palette covering every action the UI supports.

_[tool: update_todos]_

_[tool: update_todos]_

Now let me write `commands.jsx` with the slash-command data and the command palette.

_[tool: write_file]_

_[tool: read_file]_

Now let me wire slash-command autocomplete into the composer.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now wire it into the app. First add `useMemo` to the React destructure and palette state.

_[tool: str_replace_edit]_

_[tool: read_file]_

Now add the ⌘K listener and `runSlash`. Let me find the abort handler to place `runSlash` near the other callbacks.

_[tool: read_file]_

_[tool: str_replace_edit]_

Now let me add the named action handlers, `runSlash`, the palette items, and the ⌘K listener — inserting before `activeSession`.

_[tool: str_replace_edit]_

Now update the render: pass new props to Composer, use named handlers in Inspector, and mount the palette.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Let me add a discoverable ⌘K button to the title bar.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

Now load `commands.jsx` in the HTML before `app.jsx`.

_[tool: str_replace_edit]_

Now the CSS for the slash menu, command palette, and the title-bar ⌘K button.Let me load it and check for errors.

_[tool: show_html]_

_[tool: get_webview_logs]_

Clean. Let me open the command palette and screenshot it.

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: save_screenshot]_

Command palette renders great — 48 grouped actions with search and keyboard hints. Let me filter to verify fuzzy search and the slash-command group.

_[tool: view_image]_

_[tool: save_screenshot]_

Fuzzy search and source tags work. Now let me verify the in-composer slash autocomplete.

_[tool: view_image]_

_[tool: show_html]_

The palette was still open (my synthetic esc dispatched on the wrong node). Let me reload and test the slash menu cleanly.

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: str_replace_edit]_

The slash menu is rendering but mispositioned — `.inputwrap` isn't a positioning context. Let me fix that.

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: view_image]_

_[tool: save_screenshot]_

The slash menu works perfectly — commands with descriptions, source (`ext`) and location (`user`/`project`) tags. Let me verify executing one (`/compact`) actually fires the action.

_[tool: view_image]_

_[tool: update_todos]_

`/compact` fired correctly — context dropped 31% → 9%, the event stream shows `message_start /compact`, and the compaction notice is appended. Everything's working: the ⌘K palette (48 grouped actions, fuzzy search, keyboard nav), in-composer slash autocomplete with source/location tags, and command execution.

_[tool: done]_

_[tool: fork_verifier_agent]_

Both features are in:

**Slash commands** — type `/` in the composer to get a live-filtered autocomplete of the agent's `get_commands` catalog: extension commands (`/compact`, `/oracle`, `/plan-mode`, `/handoff`…), prompt templates (`/fix-tests`, `/review`, `/commit`, `/cl`), and skills (`/skill:brave-search`…), each tagged with its source (`ext`/`prompt`/`skill`) and location (`user`/`project`). Arrow-keys + ⏎/Tab to run, esc to dismiss. Commands actually execute — `/compact` compacts context, prompt templates kick off an agent turn, skills/extensions post an invocation result.

**Command palette (⌘K)** — a global launcher covering *everything* the UI does, grouped into Session (new/fork/clone/export), Switch session, Run control (abort, steer/follow-up mode), Model (all 5), Thinking level, Context (compact, auto-compaction, auto-retry), Appearance (accent, density, inspector, mono), and the full slash-command catalog. Fuzzy search, ↑↓ navigation, ⏎ to run. Open it with ⌘K/Ctrl+K, the title-bar **commands** button, or the **⌘K palette** chip in the composer.

Try `/` in the input or hit ⌘K. Want me to add command aliases/recent-commands, or make `/session-name` and similar pop the extension-UI input dialog instead of running immediately?

