/**
 * Test-only WebSocket double. Mirrors the relevant slice of the browser
 * WebSocket interface that `RelayRoom` actually exercises (constructor,
 * readyState, onopen/onmessage/onclose/onerror, send/close, the static
 * CONNECTING/OPEN/CLOSING/CLOSED constants).
 *
 * Each construction is recorded so tests can grab the most recent instance
 * via `MockWebSocket.last` and drive it directly.
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
  readonly sent: string[] = [];

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

  fakeOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }

  fakeServerFrame(data: string): void {
    this.onmessage?.({ data });
  }

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
