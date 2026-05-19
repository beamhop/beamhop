import type { Sandbox } from "microsandbox";

export interface ScriptStep {
  kind: "started" | "stdout" | "stderr" | "exited";
  data?: Uint8Array;
  pid?: number;
  code?: number;
  /** Delay in ms before emitting this event. */
  delayMs?: number;
}

export interface CapturedCall {
  cmd: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  tty: boolean;
  stdinPiped: boolean;
}

/**
 * Returns a `Sandbox`-shaped fake whose `execStreamWith` returns a fake
 * `ExecHandle` that replays `script` events in order, plus a `calls` log
 * capturing every option set on the builder.
 *
 * The fake is deliberately minimal — only the methods sandbox-exec actually
 * touches are implemented; everything else throws to flag accidental usage.
 */
export function makeFakeSandbox(script: ScriptStep[]) {
  const calls: CapturedCall[] = [];
  const stdinChunks: Buffer[] = [];
  let stdinClosed = false;
  let killed = false;

  const fakeBuilder = (capture: CapturedCall) => {
    const b: any = {
      arg(a: string) {
        capture.args.push(a);
        return b;
      },
      args(arr: string[]) {
        capture.args.push(...arr);
        return b;
      },
      cwd(c: string) {
        capture.cwd = c;
        return b;
      },
      env(k: string, v: string) {
        capture.env[k] = v;
        return b;
      },
      envs(obj: Record<string, string>) {
        Object.assign(capture.env, obj);
        return b;
      },
      tty(enabled: boolean) {
        capture.tty = enabled;
        return b;
      },
      stdinPipe() {
        capture.stdinPiped = true;
        return b;
      },
      stdinNull() {
        return b;
      },
    };
    return b;
  };

  const fakeStdinSink = {
    async write(data: Buffer | Uint8Array | string) {
      const buf =
        typeof data === "string"
          ? Buffer.from(data, "utf8")
          : Buffer.from(data);
      stdinChunks.push(buf);
    },
    async close() {
      stdinClosed = true;
    },
  };

  const handle = {
    async takeStdin() {
      return fakeStdinSink;
    },
    async kill() {
      killed = true;
    },
    async wait() {
      return { code: 0 };
    },
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i >= script.length) return { value: undefined, done: true };
          const step = script[i++]!;
          if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
          return { value: step, done: false };
        },
      };
    },
  };

  const sandbox = {
    async execStreamWith(cmd: string, configure: (b: any) => any) {
      const capture: CapturedCall = {
        cmd,
        args: [],
        env: {},
        tty: false,
        stdinPiped: false,
      };
      configure(fakeBuilder(capture));
      calls.push(capture);
      return handle as any;
    },
    async execStream(cmd: string, args?: Iterable<string>) {
      const capture: CapturedCall = {
        cmd,
        args: args ? Array.from(args) : [],
        env: {},
        tty: false,
        stdinPiped: false,
      };
      calls.push(capture);
      return handle as any;
    },
  } as unknown as Sandbox;

  return {
    sandbox,
    calls,
    stdinChunks,
    isStdinClosed: () => stdinClosed,
    wasKilled: () => killed,
  };
}
