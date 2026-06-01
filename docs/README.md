# docs

## Transport & persistence diagram

[`transport.d2`](./transport.d2) shows how data moves across beamhop's layers
and where it is durably persisted. Rendered output: [`transport.svg`](./transport.svg).

### The one idea

The whole system shares **one logical data model**: a [GunDB](https://gun.eco)
graph, namespaced per room. Every layer holds a replica of that graph and they
reconcile over GunDB's wire protocol carried on WebSockets.

- **Guests never call OpenCode directly.** They write *commands* into the graph.
- **The single host** consumes the command queue, calls OpenCode, and mirrors
  results (sessions / messages / streamed parts) back into the graph.
- Those graph writes sync to the relay and fan back out to every guest.

So the request path is `guest → commands/{id} → host → OpenCode`, and the
response path is `OpenCode events → host → sessions/messages/parts → guests` —
both legs are just GunDB sync.

### Where state lives

| Layer | Store | Persisted? |
|-------|-------|-----------|
| Guest (browser) | in-memory Gun graph | **No** — ephemeral by design (no radisk, no Gun `localStorage`); relay is source of truth. `localStorage` holds only prefs: `beamhop-guest-id`, `beamhop-theme`, `beamhop-model`. |
| Relay | Gun graph | **Yes** — radisk `./radata` |
| Host | Gun graph | **Yes** — radisk `./radata-host` |
| OpenCode | its own session store | outside the Gun graph |

### Regenerate

```sh
d2 docs/transport.d2 docs/transport.svg      # requires d2 (https://d2lang.com)
d2 --watch docs/transport.d2                 # live preview while editing
```
