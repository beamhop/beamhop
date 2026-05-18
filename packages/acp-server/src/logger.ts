import type { LogEntry, LogLevel } from "@beamhop/acp-protocol";

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface ConsoleLoggerOptions {
  level?: LogLevel;
  /** "json" in prod, "pretty" in dev. Defaults to "json" unless NODE_ENV !== "production". */
  format?: "json" | "pretty";
  baseContext?: Record<string, unknown>;
  /** Optional sink — receives every entry that passes the level filter. */
  sink?: (entry: LogEntry) => void;
}

export function createConsoleLogger(opts: ConsoleLoggerOptions = {}): Logger {
  const minLevel = opts.level ?? "info";
  const format =
    opts.format ?? (process.env.NODE_ENV === "production" ? "json" : "pretty");
  const base = opts.baseContext ?? {};

  function write(level: LogLevel, message: string, context?: Record<string, unknown>) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const merged = context ? { ...base, ...context } : base;
    const entry: LogEntry = { level, message, ts: Date.now(), context: merged };
    opts.sink?.(entry);
    if (format === "json") {
      console[level === "debug" ? "log" : level](JSON.stringify(entry));
      return;
    }
    const tag = `[acp:${level}]`;
    const ctxStr = Object.keys(merged).length ? ` ${JSON.stringify(merged)}` : "";
    console[level === "debug" ? "log" : level](`${tag} ${message}${ctxStr}`);
  }

  return {
    debug: (m, c) => write("debug", m, c),
    info: (m, c) => write("info", m, c),
    warn: (m, c) => write("warn", m, c),
    error: (m, c) => write("error", m, c),
    child(context) {
      return createConsoleLogger({ ...opts, baseContext: { ...base, ...context } });
    },
  };
}
