import { useEffect, useState } from "react";
import type { AvailableCommand } from "@beamhop/acp-protocol";
import { cn } from "../lib/cn.js";

/**
 * Floating slash-command picker shown above the composer when the input
 * starts with `/`. Pure presentation — the SDK provides the data, the
 * parent owns the input state and the "insert command" callback.
 */
export function SlashCommandMenu({
  commands,
  selectedIndex,
  onPick,
  onClose,
}: {
  commands: AvailableCommand[];
  selectedIndex: number;
  onPick: (cmd: AvailableCommand) => void;
  onClose: () => void;
}) {
  // Close menu on Escape (capture at the document level so we don't have to
  // fight the textarea for focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (commands.length === 0) {
    return (
      <div
        className="border border-rule bg-ink-2 px-3 py-2 text-[11px] text-fog leading-relaxed"
        data-testid="slash-menu-empty"
      >
        no slash commands advertised by this agent
      </div>
    );
  }

  return (
    <ul
      role="listbox"
      data-testid="slash-menu"
      className="border border-rule bg-ink-2 max-h-[280px] overflow-y-auto divide-y divide-[var(--color-rule-soft)]"
    >
      {commands.map((cmd, i) => (
        <li
          key={cmd.name}
          role="option"
          aria-selected={i === selectedIndex}
          data-testid="slash-item"
          data-slash-command={cmd.name}
          onMouseDown={(e) => {
            // Use mousedown so the textarea doesn't lose focus before we run.
            e.preventDefault();
            onPick(cmd);
          }}
          className={cn(
            "px-3 py-2 cursor-pointer flex items-baseline gap-3",
            i === selectedIndex && "bg-ink-3",
          )}
        >
          <span
            className={cn(
              "text-[12px] tabular-nums shrink-0 w-[80px]",
              i === selectedIndex ? "text-amber" : "text-bone",
            )}
          >
            /{cmd.name}
          </span>
          <span className="text-[11px] text-fog truncate">{cmd.description}</span>
        </li>
      ))}
    </ul>
  );
}

/** Insert helper: if user already typed `/foo bar`, only replace `/foo` (preserve args). */
export function insertCommand(input: string, name: string): string {
  const spaceIdx = input.indexOf(" ");
  const tail = spaceIdx === -1 ? "" : input.slice(spaceIdx);
  return `/${name}${tail || " "}`;
}

/** Tiny hook to manage menu selection index + arrow-key navigation. */
export function useSlashSelection(commandCount: number) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Reset selection when the matched-command list size changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [commandCount]);
  const move = (delta: number) => {
    if (commandCount === 0) return;
    setSelectedIndex((i) => ((i + delta) % commandCount + commandCount) % commandCount);
  };
  return { selectedIndex, setSelectedIndex, move };
}
