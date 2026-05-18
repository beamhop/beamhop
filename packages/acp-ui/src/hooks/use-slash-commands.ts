import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { AvailableCommand } from "@beamhop/acp-protocol";
import { useAcp } from "../context.js";

export interface UseSlashCommandsResult {
  /** Full list of commands advertised by the current agent (may be empty). */
  commands: AvailableCommand[];
  /**
   * Parses a composer input string. Returns the matching commands when the
   * input looks like the user is typing a slash command (starts with `/`),
   * otherwise `null` (no menu).
   *
   *   match("")            → null
   *   match("/")           → all commands
   *   match("/ini")        → commands starting with "ini"
   *   match("/init ")      → null (past the command token; let the user type args)
   *   match("hello")       → null
   */
  match: (input: string) => AvailableCommand[] | null;
}

/**
 * Subscribe to the active session's slash-command catalog. Re-renders whenever
 * the agent advertises a new list (via `session/update available_commands_update`).
 */
export function useSlashCommands(): UseSlashCommandsResult {
  const session = useAcp();
  // useSyncExternalStore is the only hook that safely reads from an external
  // mutable store: it re-runs `getSnapshot` after subscribing, eliminating the
  // attach-then-read race that plagues useEffect + useState. Without this,
  // commands that arrived between render and effect mount would be lost.
  const commands = useSyncExternalStore(
    useCallback(
      (onChange) => session.on("commands", () => onChange()),
      [session],
    ),
    () => session.availableCommands,
    () => session.availableCommands,
  );

  const match = useCallback(
    (input: string): AvailableCommand[] | null => {
      if (!input.startsWith("/")) return null;
      // Anything past a whitespace = the user is now typing arguments, hide menu.
      const firstSpace = input.indexOf(" ");
      if (firstSpace !== -1) return null;
      const query = input.slice(1).toLowerCase();
      if (commands.length === 0) return [];
      if (query === "") return commands;
      return commands.filter((c) => c.name.toLowerCase().startsWith(query));
    },
    [commands],
  );

  return useMemo(() => ({ commands, match }), [commands, match]);
}
