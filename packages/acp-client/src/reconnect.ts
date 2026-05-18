export interface ReconnectOptions {
  enabled?: boolean;
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
}

export interface ReconnectPolicy {
  readonly enabled: boolean;
  /** Returns the delay for the next attempt, or null if attempts are exhausted. */
  next(): number | null;
  reset(): void;
}

export function makeReconnect(opts: ReconnectOptions = {}): ReconnectPolicy {
  const enabled = opts.enabled ?? true;
  const maxAttempts = opts.maxAttempts ?? 10;
  const initial = opts.initialDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 15_000;
  const jitter = opts.jitter ?? 0.3;
  let attempt = 0;

  return {
    enabled,
    next() {
      if (!enabled) return null;
      if (attempt >= maxAttempts) return null;
      const base = Math.min(initial * 2 ** attempt, max);
      const jitterDelta = base * jitter * (Math.random() * 2 - 1);
      attempt += 1;
      return Math.max(0, Math.round(base + jitterDelta));
    },
    reset() {
      attempt = 0;
    },
  };
}
