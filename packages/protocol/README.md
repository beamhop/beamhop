# @beamhop/protocol

Shared wire helpers for the pi-mono RPC bridge. Tiny on purpose: just
enough to keep stdio framing and command-name aliasing in one place.

Currently consumed by `@beamhop/host`. The browser-side reducer
(`apps/web/src/rpc/`) speaks the post-bridge JSON, not raw stdio, so it
doesn't depend on this package today — but if you ever need to share a
type like `WireMessage`, this is the place.

## Exports

```ts
import {
  LineSplitter,    // newline-only JSONL splitter (CRLF-tolerant)
  toPiWire,        // frontend short name → canonical pi name
  fromPiWire,      // pi → frontend (pass-through today)
  type WireMessage,
} from "@beamhop/protocol";
```

### `LineSplitter`

Splits a stream into complete lines on `\n` only. **Don't** use
Node/Bun's `readline` — it also splits on U+2028 / U+2029, which would
corrupt JSON payloads that legitimately contain those characters.

```ts
const s = new LineSplitter();
for (const line of s.push(chunk)) handle(JSON.parse(line));
// s.remainder() holds any unterminated tail
```

### `toPiWire` / `fromPiWire`

`toPiWire` rewrites short command names from the design vocabulary
(`new`, `switch`, `session-name`, `plan-mode`, `cycle_thinking`) into
pi-mono's canonical snake_case names (`new_session`, `switch_session`,
…). Anything already canonical passes through.

`fromPiWire` is a pass-through today — we deliberately keep canonical
event names on the wire so the reducer matches the official protocol.
Any UI-side renaming happens in the store.

## Tests

```sh
cd packages/protocol
bun test
```

The framing tests are the contract for stdio safety — touch them
carefully.
