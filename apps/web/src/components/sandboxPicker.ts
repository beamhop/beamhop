/**
 * Pure state machine for the sandbox-picker's short-lived WebSocket session.
 *
 * Extracted from SandboxPrompt's effect so the success/error/close ordering
 * can be unit-tested without a DOM or a real socket. The component wires the
 * real `WebSocket` events to these methods; the machine decides the next
 * LoadState and whether to close the socket.
 *
 * The bug this guards against: after a *successful* `list_sandboxes` we close
 * the socket, which fires `close`. A naive handler that reports an error on
 * any close-while-loading would clobber the result. The machine tracks a
 * single `settled` latch so the first resolution (success OR error) wins and
 * later events (including the close we initiate) are ignored.
 */

export interface SandboxInfo {
  name: string;
  status: "running" | "stopped" | "crashed" | "draining" | string;
  createdAt: string | null;
}

export type PickerState =
  | { kind: "loading" }
  | { kind: "ready"; sandboxes: SandboxInfo[] }
  | { kind: "error"; message: string };

export interface PickerEffect {
  /** Next UI state, or null to leave it unchanged. */
  state: PickerState | null;
  /** Whether the caller should `ws.close()` now. */
  close: boolean;
}

const NOOP: PickerEffect = { state: null, close: false };

export class SandboxPickerMachine {
  private settled = false;

  /** The message to send once the socket opens. */
  static readonly LIST_REQUEST = JSON.stringify({ type: "list_sandboxes" });

  /** Handle a raw WebSocket message payload (string). */
  onMessage(raw: unknown): PickerEffect {
    if (this.settled) return NOOP;
    let msg: { command?: string; success?: boolean; error?: unknown; data?: { sandboxes?: SandboxInfo[] } };
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : "");
    } catch (err) {
      return this.settle({ kind: "error", message: String(err) }, false);
    }
    if (msg?.command !== "list_sandboxes") return NOOP;
    if (msg.success) {
      return this.settle(
        { kind: "ready", sandboxes: msg.data?.sandboxes ?? [] },
        /*close*/ true,
      );
    }
    return this.settle(
      { kind: "error", message: String(msg.error ?? "list_sandboxes failed") },
      /*close*/ true,
    );
  }

  onError(): PickerEffect {
    if (this.settled) return NOOP;
    return this.settle({ kind: "error", message: "could not reach host" }, false);
  }

  /** Handle the socket closing. `reason` is the WS close-event reason. */
  onClose(reason?: string): PickerEffect {
    // If we already resolved (the common case — we close the socket ourselves
    // right after a successful response), this is a no-op. Only an unsolicited
    // close *before* resolution is an error.
    if (this.settled) return NOOP;
    return this.settle(
      { kind: "error", message: reason || "connection closed before response" },
      false,
    );
  }

  private settle(state: PickerState, close: boolean): PickerEffect {
    this.settled = true;
    return { state, close };
  }
}
