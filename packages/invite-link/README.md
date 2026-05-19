# @beamhop/invite-link

Encode and decode beamhop session join links. Pure functions, no I/O — symmetric across the desktop emitter and the web joiner.

The payload lives in the URL **fragment** (`#…`) so it never reaches your relay's access logs.

## Install

```sh
bun add @beamhop/invite-link
```

## Usage

```ts
import { encode, decode } from "@beamhop/invite-link";

const fragment = encode({
  kind: "terminal",
  room: "ab12-cd34",
  password: "hunter2",
  relayUrls: ["wss://relay.example.com"],
});
// "#v=1&k=terminal&r=ab12-cd34&pw=hunter2&rl=wss%3A%2F%2Frelay.example.com"

const url = `https://join.example.com/${fragment}`;
const parsed = decode(url);
// { kind: "terminal", room: "ab12-cd34", password: "hunter2", relayUrls: [...], version: 1 }
```

## API

- `encode(invite: Invite): string` — returns a URL fragment beginning with `#`.
- `decode(input: string | URL): DecodeResult` — accepts a full URL or a bare fragment.
- `Invite`, `DecodeResult`, `InviteKind` — TypeScript types.
