import { useEffect, useRef, useState } from "react";
import { type PiCommand } from "../data/commands";
import { PROVIDER_DOT, type PiModel, type ThinkingLevel } from "../data/models";
import { useTextAreaAutoResize } from "../hooks/useTextAreaAutoResize";
import { ModelPicker } from "./composer/ModelPicker";
import { ThinkingPicker } from "./composer/ThinkingPicker";
import { SlashCommandMenu } from "./composer/SlashCommandMenu";

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
  /** When set, the composer is replaced by a read-only notice (e.g. viewing
   * a view-only shared session). */
  disabledReason?: string | null;
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
    disabledReason,
  } = props;
  const [text, setText] = useState("");
  const [showModel, setShowModel] = useState(false);
  const [showThink, setShowThink] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  useTextAreaAutoResize(ta, text);

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

  if (disabledReason) {
    return (
      <div className="composer" data-testid="composer">
        <div className="composer-disabled mono" data-testid="composer-disabled">
          {disabledReason}
        </div>
      </div>
    );
  }

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
        {slashOpen && (
          <SlashCommandMenu
            matches={slashMatches}
            sel={slashSel}
            onHover={setSlashSel}
            onPick={pickSlash}
          />
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
