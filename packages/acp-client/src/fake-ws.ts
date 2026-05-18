/**
 * Tiny in-memory WebSocket double used by the test suite. Implements the
 * shape `connection.ts` actually exercises (constructor + onopen/onmessage/
 * onerror/onclose + send/close + readyState + the CONNECTING/OPEN/CLOSING/
 * CLOSED statics).
 *
 * The constructor exposes `MockWebSocket.last` so tests can poke into the
 * most recently created instance to fake server frames.
 */
export class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: MockWebSocket | null = null;
  static instances: MockWebSocket[] = [];
  static onConstruct: ((ws: MockWebSocket) => void) | null = null;

  readonly url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((evt: unknown) => void) | null = null;
  onmessage: ((evt: { data: string | ArrayBuffer }) => void) | null = null;
  onerror: ((evt: unknown) => void) | null = null;
  onclose: ((evt: { code: number; reason: string }) => void) | null = null;
  /** Frames the *client code* sent via .send(). */
  readonly sent: string[] = [];
  /** Frames received from the test (via `.fakeServerFrame()`). */
  readonly received: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.last = this;
    MockWebSocket.instances.push(this);
    MockWebSocket.onConstruct?.(this);
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error(`MockWebSocket.send while readyState=${this.readyState}`);
    }
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }

  // ---- test driver methods ----

  /** Drives the open handshake. */
  fakeOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }

  /** Push a frame as if it came from the server. */
  fakeServerFrame(data: string): void {
    this.received.push(data);
    this.onmessage?.({ data });
  }

  /** Trigger a close as if initiated by the server. */
  fakeServerClose(code: number, reason: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  static reset(): void {
    MockWebSocket.last = null;
    MockWebSocket.instances.length = 0;
    MockWebSocket.onConstruct = null;
  }
}
