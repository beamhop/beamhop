import { useEffect, useRef, useState } from "react";
import { PROVIDER_DOT, type PiModel } from "../../data/models";
import { fuzzyMatch } from "../../utils/fuzzyMatch";
import { Popover } from "./Popover";

/** Searchable, keyboard-navigable model picker shown from the composer chip. */
export function ModelPicker({
  models,
  current,
  onPick,
  onClose,
}: {
  models: PiModel[];
  current: string;
  onPick: (m: PiModel) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = models.filter((m) => fuzzyMatch(q, `${m.name} ${m.id} ${m.provider} ${m.api}`));

  // Reset selection when the filter changes.
  useEffect(() => {
    setSel(0);
  }, [q]);

  // Keep the selected row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector(".pop-row.sel") as HTMLElement | null;
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [sel, q]);

  // Autofocus the search on open.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(filtered.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = filtered[sel];
      if (m) {
        onPick(m);
        onClose();
      }
    }
    // Escape falls through to Popover's document-level listener, which closes us.
  };

  return (
    <Popover onClose={onClose} className="modelpop" onKeyDown={onKey}>
      <div className="pop-search" data-testid="model-picker">
        <span className="searchglyph">⌕</span>
        <input
          ref={inputRef}
          placeholder="Search models…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="model-pick-search"
        />
      </div>
      <div className="pop-title eyebrow">
        {models.length === 0
          ? "Model · waiting for pi…"
          : q
            ? `Model · ${filtered.length} of ${models.length}`
            : `Model · ${models.length} configured`}
      </div>
      <div className="pop-list" ref={listRef}>
        {models.length === 0 && (
          <div className="pop-empty" data-testid="model-pick-empty">
            No models reported yet
          </div>
        )}
        {models.length > 0 && filtered.length === 0 && (
          <div className="pop-empty">No models match "{q}"</div>
        )}
        {filtered.map((m, i) => (
          <button
            key={m.id}
            className={"pop-row" + (m.name === current ? " on" : "") + (i === sel ? " sel" : "")}
            onMouseEnter={() => setSel(i)}
            onClick={() => {
              onPick(m);
              onClose();
            }}
            data-testid={`model-pick-${m.id}`}
          >
            <span className="provdot" style={{ background: PROVIDER_DOT[m.provider] }} />
            <span className="pop-prov mono" style={{ color: PROVIDER_DOT[m.provider] }}>
              {m.provider}
            </span>
            <span className="pop-name">{m.name}</span>
            <span className="pop-sub mono">
              {(m.contextWindow / 1000) | 0}k · ${m.cost.input}/${m.cost.output}
            </span>
            {m.reasoning && (
              <span className="reasonpip mono" title="supports reasoning">
                ✦
              </span>
            )}
            {m.name === current && <span className="pop-check">✓</span>}
          </button>
        ))}
      </div>
      <div className="pop-foot mono">↑↓ select · ⏎ pick · esc close</div>
    </Popover>
  );
}
