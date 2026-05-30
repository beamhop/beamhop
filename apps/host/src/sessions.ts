/**
 * Pi session-file operations inside a sandbox.
 *
 * Pi stores one JSONL file per session under `~/.pi/agent/sessions/<cwd>/`.
 * These functions walk that tree to enumerate, summarize, and clear sessions.
 * They take a sandbox `fs` handle so they stay decoupled from the bridge's
 * process lifecycle and are independently testable.
 */
import type { SandboxFs } from "microsandbox";
import type { SessionSummary } from "@beamhop/protocol";

/** Root of pi's per-session JSONL store inside the sandbox (pi runs as root). */
const SESSIONS_ROOT = "/root/.pi/agent/sessions";

/** List a dir, treating "does not exist" as empty rather than throwing. */
async function listOrEmpty(
  fs: SandboxFs,
  path: string,
): Promise<Awaited<ReturnType<SandboxFs["list"]>>> {
  try {
    return await fs.list(path);
  } catch {
    return [];
  }
}

/**
 * One parsed line of a pi session file. Only the fields we read are listed;
 * everything else pi writes is ignored.
 */
interface SessionRecord {
  type?: string;
  id?: string;
  cwd?: string;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
}

function isSessionRecord(rec: unknown): rec is SessionRecord {
  return typeof rec === "object" && rec !== null;
}

/**
 * Delete every `.jsonl` session file under `~/.pi/agent/sessions/`. Pi may
 * currently be writing to one of them; the caller should issue a
 * `new_session` afterwards so pi opens a fresh file with a clean handle.
 * Empty cwd directories are left in place — they're cheap. Returns the
 * number of files removed.
 */
export async function clearAllSessions(fs: SandboxFs): Promise<number> {
  const cwdDirs = await listOrEmpty(fs, SESSIONS_ROOT);
  let removed = 0;
  await Promise.all(
    cwdDirs
      .filter((d) => d.kind === "directory")
      .map(async (d) => {
        let files: Awaited<ReturnType<typeof fs.list>>;
        try {
          files = await fs.list(d.path);
        } catch {
          return;
        }
        for (const f of files) {
          if (f.kind !== "file" || !f.path.endsWith(".jsonl")) continue;
          try {
            await fs.remove(f.path);
            removed++;
          } catch {
            // Ignore — likely the active session file pi has open.
          }
        }
      }),
  );
  return removed;
}

/**
 * Scan the sandbox's pi session directory and return one summary per session
 * file. Skips files that contain no user message (pi creates a fresh empty
 * session on every RPC connect; those would clutter the sidebar). Sorted
 * newest-first by modification time.
 */
export async function listSessions(fs: SandboxFs): Promise<SessionSummary[]> {
  const cwdDirs = await listOrEmpty(fs, SESSIONS_ROOT);
  const out: SessionSummary[] = [];
  await Promise.all(
    cwdDirs
      .filter((d) => d.kind === "directory")
      .map(async (d) => {
        let files: Awaited<ReturnType<typeof fs.list>>;
        try {
          files = await fs.list(d.path);
        } catch {
          return;
        }
        for (const f of files) {
          if (f.kind !== "file" || !f.path.endsWith(".jsonl")) continue;
          try {
            const summary = await summarizeSessionFile(fs, f.path, f.modified, f.size);
            if (summary) out.push(summary);
          } catch {
            // Ignore unreadable files.
          }
        }
      }),
  );
  out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return out;
}

/**
 * Read a session file just-enough to extract its display summary. Skips the
 * file if it has no user message (pi creates an empty file on every RPC
 * connect; we don't want those in the sidebar).
 */
export async function summarizeSessionFile(
  fs: Pick<SandboxFs, "readToString">,
  path: string,
  modified: Date | null,
  size: number,
): Promise<SessionSummary | null> {
  const raw = await fs.readToString(path);
  let sessionId: string | null = null;
  let cwd = "";
  let title = "";
  let messageCount = 0;
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isSessionRecord(rec)) continue;
    if (rec.type === "session") {
      if (typeof rec.id === "string") sessionId = rec.id;
      if (typeof rec.cwd === "string") cwd = rec.cwd;
    } else if (rec.type === "message") {
      messageCount++;
      if (!title && rec.message?.role === "user") {
        const text = rec.message.content?.find((c) => c.type === "text")?.text;
        if (typeof text === "string" && text.length > 0) {
          title = text.length > 80 ? text.slice(0, 77) + "…" : text;
        }
      }
    }
  }
  if (!title) return null;
  return {
    path,
    sessionId,
    title,
    cwd,
    updatedAt: modified ? modified.getTime() : null,
    messageCount,
    sizeBytes: size,
  };
}
