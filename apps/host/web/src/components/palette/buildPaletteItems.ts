import type { PaletteItem } from "../CommandPalette";
import type { PiCommand } from "../../data/commands";
import { THINKING_LEVELS, type PiModel, type ThinkingLevel } from "../../data/models";
import type { SessionSummary, Toggles, Tweaks } from "../../types";

/**
 * Everything the command palette needs to assemble its items: current state
 * to label/branch on, plus the handlers each item invokes. Kept as a plain
 * argument object so this stays a pure function — easy to read and test.
 */
export interface PaletteContext {
  // state
  sessions: SessionSummary[] | null;
  currentSessionFile: string | null;
  streaming: boolean;
  toggles: Toggles;
  tweaks: Tweaks;
  models: PiModel[];
  commands: PiCommand[];
  // session actions
  onNew: () => void;
  onFork: () => void;
  onClone: () => void;
  onExport: () => void;
  onSwitchSession: (path: string) => void;
  // run control
  onAbort: () => void;
  setQueueMode: (mode: "steer" | "followUp") => void;
  // model / thinking
  onPickModel: (m: PiModel) => void;
  onSetThinking: (lv: ThinkingLevel) => void;
  // context
  onCompact: () => void;
  onToggle: (k: keyof Toggles, v: boolean) => void;
  // appearance
  setTweak: <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void;
  // slash + toasts
  runSlash: (c: PiCommand) => void;
  toast: (text: string, glyph?: string, tone?: "warn" | "ok") => void;
}

/** Build the full, flat list of command-palette items from current state. */
export function buildPaletteItems(ctx: PaletteContext): PaletteItem[] {
  const items: PaletteItem[] = [];
  const add = (
    group: string,
    label: string,
    run: () => void,
    opts: Partial<PaletteItem> = {},
  ) => items.push({ id: group + ":" + label, group, label, run, ...opts });

  add("Session", "New session", ctx.onNew, { kbd: "⌘N", glyph: "+" });
  add("Session", "Fork from a previous message", ctx.onFork, { glyph: "⑂" });
  add("Session", "Clone current branch", ctx.onClone, { glyph: "⧉" });
  add("Session", "Export session to HTML", ctx.onExport, { glyph: "↗" });

  (ctx.sessions ?? [])
    .filter((s) => s.path !== ctx.currentSessionFile)
    .slice(0, 20)
    .forEach((s) =>
      add("Switch session", s.title || "(untitled)", () => ctx.onSwitchSession(s.path), {
        hint: s.cwd,
        glyph: "›",
      }),
    );

  if (ctx.streaming)
    add("Run control", "Abort current run", ctx.onAbort, { kbd: "esc", glyph: "✕" });
  add(
    "Run control",
    "Queue next message as steering",
    () => {
      ctx.setQueueMode("steer");
      ctx.toast("Queue mode → steer", "↻");
    },
    { glyph: "↻" },
  );
  add(
    "Run control",
    "Queue next message as follow-up",
    () => {
      ctx.setQueueMode("followUp");
      ctx.toast("Queue mode → follow-up", "→");
    },
    { glyph: "→" },
  );

  ctx.models.forEach((m) =>
    add("Model", "Use " + m.name, () => ctx.onPickModel(m), {
      hint: m.provider + " · " + ((m.contextWindow / 1000) | 0) + "k",
      glyph: "◆",
    }),
  );
  THINKING_LEVELS.forEach((lv) =>
    add("Thinking level", "Thinking: " + lv, () => ctx.onSetThinking(lv), { glyph: "✦" }),
  );

  add("Context", "Compact context now", ctx.onCompact, { glyph: "⤵" });
  add(
    "Context",
    (ctx.toggles.autoCompact ? "Disable" : "Enable") + " auto-compaction",
    () => ctx.onToggle("autoCompact", !ctx.toggles.autoCompact),
    { glyph: "◑" },
  );
  add(
    "Context",
    (ctx.toggles.autoRetry ? "Disable" : "Enable") + " auto-retry",
    () => ctx.onToggle("autoRetry", !ctx.toggles.autoRetry),
    { glyph: "↺" },
  );

  (["blue", "green", "amber", "violet"] as const).forEach((a) =>
    add(
      "Appearance",
      "Accent: " + a,
      () => {
        ctx.setTweak("accent", a);
        ctx.toast("Accent → " + a);
      },
      { glyph: "●" },
    ),
  );
  (["compact", "regular", "comfy"] as const).forEach((d) =>
    add("Appearance", "Density: " + d, () => ctx.setTweak("density", d), { glyph: "▤" }),
  );
  add(
    "Appearance",
    (ctx.tweaks.showEvents ? "Hide" : "Show") + " RPC inspector",
    () => ctx.setTweak("showEvents", !ctx.tweaks.showEvents),
    { glyph: "▦" },
  );
  add(
    "Appearance",
    ctx.tweaks.monoEverywhere ? "Disable mono-everywhere" : "Enable mono-everywhere",
    () => ctx.setTweak("monoEverywhere", !ctx.tweaks.monoEverywhere),
    { glyph: "M" },
  );

  ctx.commands.forEach((c) =>
    add("Slash command", "/" + c.name, () => ctx.runSlash(c), {
      hint: c.desc,
      source: c.source,
    }),
  );

  return items;
}
