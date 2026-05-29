export type CmdSource = "extension" | "prompt" | "skill";

export interface PiCommand {
  name: string;
  desc: string;
  source: CmdSource;
  loc: "user" | "project";
}

export const CMD_SOURCE: Record<
  CmdSource,
  { c: string; label: string; glyph: string }
> = {
  extension: { c: "var(--blue)", label: "ext", glyph: "⚙" },
  prompt: { c: "var(--green)", label: "prompt", glyph: "❯" },
  skill: { c: "var(--violet)", label: "skill", glyph: "✦" },
};
