import { useEffect, useMemo, useRef, useState } from "react";
import { CMD_SOURCE, type CmdSource } from "../data/commands";

export interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  kbd?: string;
  source?: CmdSource;
  glyph?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
}

export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => {
      const hay = (it.label + " " + (it.hint ?? "") + " " + it.group).toLowerCase();
      if (hay.includes(needle)) return true;
      let i = 0;
      for (const ch of hay) {
        if (ch === needle[i]) i++;
        if (i === needle.length) return true;
      }
      return false;
    });
  }, [q, items]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector(".cp-row.sel");
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const run = (it?: PaletteItem) => {
    onClose();
    if (it) setTimeout(() => it.run(), 0);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(filtered.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[sel]);
    }
  };

  const groups: { name: string; rows: Array<{ it: PaletteItem; idx: number }> }[] = [];
  const gmap: Record<string, number> = {};
  filtered.forEach((it, idx) => {
    if (gmap[it.group] === undefined) {
      gmap[it.group] = groups.length;
      groups.push({ name: it.group, rows: [] });
    }
    groups[gmap[it.group]].rows.push({ it, idx });
  });

  return (
    <div
      className="cp-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="palette"
    >
      <div className="cp" onKeyDown={onKey}>
        <div className="cp-inputwrap">
          <span className="cp-prompt mono">⌘K</span>
          <input
            ref={inputRef}
            className="cp-input"
            placeholder="Search actions, models, sessions, slash commands…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="palette-input"
          />
          <span className="cp-esc mono">esc</span>
        </div>
        <div className="cp-list" ref={listRef}>
          {filtered.length === 0 && <div className="cp-empty mono">No matches for "{q}"</div>}
          {groups.map((g) => (
            <div className="cp-group" key={g.name}>
              <div className="cp-ghdr eyebrow">{g.name}</div>
              {g.rows.map(({ it, idx }) => {
                const src = it.source ? CMD_SOURCE[it.source] : null;
                return (
                  <button
                    key={it.id}
                    className={"cp-row" + (idx === sel ? " sel" : "")}
                    onMouseEnter={() => setSel(idx)}
                    onClick={() => run(it)}
                    data-testid={`palette-row-${it.id}`}
                  >
                    <span
                      className="cp-glyph"
                      style={{ color: src ? src.c : "var(--tx-faint)" }}
                    >
                      {src ? src.glyph : it.glyph || "›"}
                    </span>
                    <span className="cp-label">{it.label}</span>
                    {it.hint && <span className="cp-hint">{it.hint}</span>}
                    {src && (
                      <span className="cp-srctag mono" style={{ color: src.c }}>
                        {src.label}
                      </span>
                    )}
                    {it.kbd && <span className="cp-kbd mono">{it.kbd}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cp-foot mono">
          <span>
            <b>↑↓</b> navigate
          </span>
          <span>
            <b>⏎</b> run
          </span>
          <span>
            <b>esc</b> close
          </span>
          <span className="cp-foot-r">
            {filtered.length} result{filtered.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>
  );
}
