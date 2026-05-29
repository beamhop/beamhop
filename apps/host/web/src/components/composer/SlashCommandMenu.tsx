import { CMD_SOURCE, type PiCommand } from "../../data/commands";

/** Autocomplete list shown while the composer text starts with `/`. */
export function SlashCommandMenu({
  matches,
  sel,
  onHover,
  onPick,
}: {
  matches: PiCommand[];
  sel: number;
  onHover: (i: number) => void;
  onPick: (c: PiCommand) => void;
}) {
  if (matches.length === 0) return null;
  return (
    <div className="slashmenu">
      <div className="slashhdr eyebrow">Commands · prefix with /</div>
      {matches.map((c, i) => {
        const src = CMD_SOURCE[c.source];
        return (
          <button
            key={c.name}
            className={"slashrow" + (i === sel ? " sel" : "")}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(c);
            }}
            data-testid={`slash-row-${c.name}`}
          >
            <span className="slashglyph" style={{ color: src.c }}>
              {src.glyph}
            </span>
            <span className="slashname mono">/{c.name}</span>
            <span className="slashdesc">{c.desc}</span>
            <span className="slashsrc mono" style={{ color: src.c }}>
              {src.label}
            </span>
            {c.loc && <span className="slashloc mono">{c.loc}</span>}
          </button>
        );
      })}
      <div className="slashfoot mono">↑↓ select · ⏎ run · esc dismiss</div>
    </div>
  );
}
