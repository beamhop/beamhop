import { useEffect, useRef, useState } from "react";
import { CMD_SOURCE, type PiCommand } from "../data/commands";
import { PROVIDER_DOT, THINKING_LEVELS, type PiModel, type ThinkingLevel } from "../data/models";

function Popover({
  children,
  onClose,
  className,
  onKeyDown,
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", h), 0);
    document.addEventListener("keydown", k);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [onClose]);
  return (
    <div className={"popover" + (className ? " " + className : "")} ref={ref} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

/** Loose subsequence/substring fuzzy match — same shape as CommandPalette's. */
function fuzzyMatch(needle: string, hay: string): boolean {
  if (!needle) return true;
  const h = hay.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return true;
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i++;
    if (i === n.length) return true;
  }
  return false;
}

function ModelPicker({
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

  const filtered = models.filter((m) =>
    fuzzyMatch(q, `${m.name} ${m.id} ${m.provider} ${m.api}`),
  );

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
            className={
              "pop-row" + (m.name === current ? " on" : "") + (i === sel ? " sel" : "")
            }
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

function ThinkingPicker({
  current,
  onPick,
  onClose,
}: {
  current: ThinkingLevel;
  onPick: (lv: ThinkingLevel) => void;
  onClose: () => void;
}) {
  return (
    <Popover onClose={onClose}>
      <div className="pop-title eyebrow">Thinking level</div>
      <div className="thinkscale">
        {THINKING_LEVELS.map((lv) => (
          <button
            key={lv}
            className={"thinkstep" + (lv === current ? " on" : "")}
            onClick={() => {
              onPick(lv);
              onClose();
            }}
            data-testid={`think-step-${lv}`}
          >
            <span
              className="thinkbar"
              style={{
                height: 6 + THINKING_LEVELS.indexOf(lv) * 4,
                background: lv === current ? "var(--violet)" : "var(--line-strong)",
              }}
            />
            <span className="thinklv mono">{lv}</span>
          </button>
        ))}
      </div>
      <div className="pop-foot mono">xhigh · codex-max only</div>
    </Popover>
  );
}

export interface ComposerProps {
  streaming: boolean;
  models: PiModel[];
  commands: PiCommand[];
  model: string;
  onPickModel: (m: PiModel) => void;
  thinking: ThinkingLevel;
  onSetThinking: (lv: ThinkingLevel) => void;
  onSend: (text: string, mode: "prompt" | "steer" | "followUp") => void;
  onAbort: () => void;
  queueMode: "steer" | "followUp";
  setQueueMode: (m: "steer" | "followUp") => void;
  onSlash: (c: PiCommand) => void;
  onOpenPalette: () => void;
}

export function Composer(props: ComposerProps) {
  const {
    streaming,
    models,
    commands,
    model,
    onPickModel,
    thinking,
    onSetThinking,
    onSend,
    onAbort,
    queueMode,
    setQueueMode,
    onSlash,
    onOpenPalette,
  } = props;
  const [text, setText] = useState("");
  const [showModel, setShowModel] = useState(false);
  const [showThink, setShowThink] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ta.current) {
      ta.current.style.height = "auto";
      ta.current.style.height = Math.min(ta.current.scrollHeight, 200) + "px";
    }
  }, [text]);

  const [slashSel, setSlashSel] = useState(0);
  const slashOpen = text.startsWith("/") && !text.slice(1).includes(" ");
  const slashQuery = slashOpen ? text.slice(1).toLowerCase() : "";
  const slashMatches = slashOpen
    ? commands.filter((c) => c.name.toLowerCase().includes(slashQuery)).slice(0, 7)
    : [];
  useEffect(() => {
    setSlashSel(0);
  }, [text]);

  const pickSlash = (c?: PiCommand) => {
    if (!c) return;
    setText("");
    onSlash(c);
  };

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    if (slashOpen && slashMatches.length) {
      pickSlash(slashMatches[Math.min(slashSel, slashMatches.length - 1)]);
      return;
    }
    onSend(v, streaming ? queueMode : "prompt");
    setText("");
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && slashMatches.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSel((s) => Math.min(slashMatches.length - 1, s + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSel((s) => Math.max(0, s - 1));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        pickSlash(slashMatches[Math.min(slashSel, slashMatches.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setText("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const sendLabel = streaming ? (queueMode === "steer" ? "Steer" : "Follow-up") : "Send";

  return (
    <div className="composer" data-testid="composer">
      {streaming && (
        <div className="runbar">
          <span className="runpulse" />
          <span className="runtext mono">agent streaming</span>
          <div className="queuetoggle">
            <button
              className={queueMode === "steer" ? "on" : ""}
              onClick={() => setQueueMode("steer")}
              data-testid="composer-queue-steer"
            >
              steer
            </button>
            <button
              className={queueMode === "followUp" ? "on" : ""}
              onClick={() => setQueueMode("followUp")}
              data-testid="composer-queue-followup"
            >
              follow-up
            </button>
          </div>
          <span className="runspacer" />
          <button className="abortbtn" onClick={onAbort} data-testid="composer-abort">
            ✕ Abort <span className="kbd mono">esc</span>
          </button>
        </div>
      )}
      <div className={"inputwrap" + (streaming ? " streaming" : "")}>
        {slashOpen && slashMatches.length > 0 && (
          <div className="slashmenu">
            <div className="slashhdr eyebrow">Commands · prefix with /</div>
            {slashMatches.map((c, i) => {
              const src = CMD_SOURCE[c.source];
              return (
                <button
                  key={c.name}
                  className={"slashrow" + (i === slashSel ? " sel" : "")}
                  onMouseEnter={() => setSlashSel(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSlash(c);
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
        )}
        <textarea
          ref={ta}
          className="prompt mono"
          rows={1}
          value={text}
          placeholder={
            streaming
              ? "Queue a message while pi runs…"
              : "Message pi —  ⏎ to send,  ⇧⏎ for newline,  / for commands"
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          data-testid="composer-prompt"
        />
        <div className="inputbar">
          <div className="chiprow">
            <div className="chipwrap">
              <button
                className="chip"
                onClick={() => setShowModel((s) => !s)}
                data-testid="composer-model-chip"
              >
                <span
                  className="provdot"
                  style={{
                    background:
                      PROVIDER_DOT[
                        (models.find((m) => m.name === model || m.id === model) ?? models[0])
                          ?.provider ?? "openrouter"
                      ],
                  }}
                />
                {model}
                <span className="chevdown">▾</span>
              </button>
              {showModel && (
                <ModelPicker
                  models={models}
                  current={model}
                  onPick={onPickModel}
                  onClose={() => setShowModel(false)}
                />
              )}
            </div>
            <div className="chipwrap">
              <button
                className="chip"
                onClick={() => setShowThink((s) => !s)}
                data-testid="composer-thinking-chip"
              >
                <span className="thinkglyph" style={{ color: "var(--violet)" }}>
                  ✦
                </span>
                {thinking}
                <span className="chevdown">▾</span>
              </button>
              {showThink && (
                <ThinkingPicker
                  current={thinking}
                  onPick={onSetThinking}
                  onClose={() => setShowThink(false)}
                />
              )}
            </div>
            <button className="chip ghost" title="Attach image">
              ＋ image
            </button>
            <button
              className="chip ghost"
              title="Slash commands"
              onClick={() => {
                setText("/");
                if (ta.current) ta.current.focus();
              }}
              data-testid="composer-slash-chip"
            >
              / commands
            </button>
            <button
              className="chip ghost"
              title="Command palette"
              onClick={onOpenPalette}
              data-testid="composer-palette-chip"
            >
              <span className="mono">⌘K</span> palette
            </button>
          </div>
          <button
            className={"sendbtn" + (streaming ? " queue" : "")}
            onClick={submit}
            disabled={!text.trim()}
            data-testid="composer-send"
          >
            {sendLabel} <span className="kbd mono">⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}
