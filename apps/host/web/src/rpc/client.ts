/**
 * Single-WebSocket client for the host bridge.
 *
 * Outbound: any pi RPC command as a JSON object (the host forwards to
 * the sandboxed pi --mode rpc child as a JSONL line).
 * Inbound: pi events (`agent_start`, `message_update`, …) plus a handful
 * of host-synthesized control messages (`ready`, `error`, `host_stderr`).
 */
import type { Transport } from "./transport";

export type Json = Record<string, unknown>;

export type RpcStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface RpcClientOptions {
  url: string;
  /** Name of the already-running microsandbox to attach to. */
  sandbox: string;
  onMessage: (msg: Json) => void;
  onStatus: (status: RpcStatus, detail?: string) => void;
}

export class RpcClient implements Transport {
  private ws: WebSocket | null = null;
  private opts: RpcClientOptions;
  private outbox: string[] = [];
  private ready = false;
  /**
   * Per-command FIFO queues of pending `request()` resolvers. pi processes
   * commands in stdin order but responses can arrive out-of-order with
   * other events (and some pi commands take longer than others), so we
   * correlate by command name. We don't fire two of the same command
   * concurrently anywhere in the app, so FIFO is sufficient.
   */
  private pending: Record<string, Array<(msg: Json) => void>> = {};

  constructor(opts: RpcClientOptions) {
    this.opts = opts;
  }

  connect(): void {
    this.opts.onStatus("connecting");
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello", sandbox: this.opts.sandbox }));
    };
    ws.onmessage = (ev) => {
      let parsed: Json;
      try {
        parsed = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      if (parsed.type === "ready") {
        this.ready = true;
        this.opts.onStatus("open");
        // flush anything that was queued before hello acked
        for (const line of this.outbox) ws.send(line);
        this.outbox = [];
      }
      if (parsed.type === "response" && typeof parsed.command === "string") {
        const q = this.pending[parsed.command];
        if (q && q.length) {
          const resolve = q.shift()!;
          resolve(parsed);
        }
      }
      this.opts.onMessage(parsed);
    };
    ws.onerror = () => this.opts.onStatus("error", "websocket error");
    ws.onclose = (ev) => {
      this.ready = false;
      this.opts.onStatus("closed", `code ${ev.code}`);
      // Reject any pending requests
      for (const cmd of Object.keys(this.pending)) {
        for (const resolve of this.pending[cmd]) {
          resolve({ type: "response", command: cmd, success: false, error: "closed" });
        }
      }
      this.pending = {};
    };
  }

  send(msg: Json): void {
    const line = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN && this.ready) {
      this.ws.send(line);
    } else {
      this.outbox.push(line);
    }
  }

  /**
   * Send a command and resolve when pi's matching `{type:"response", command}`
   * envelope arrives. Useful for sequencing dependent calls (e.g.
   * `switch_session` must complete before `get_messages` reads the right
   * file). Responses are still also fanned out via `onMessage` so the
   * reducer sees them.
   */
  request(msg: Json): Promise<Json> {
    const command = String(msg.type);
    return new Promise((resolve) => {
      (this.pending[command] ||= []).push(resolve);
      this.send(msg);
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
