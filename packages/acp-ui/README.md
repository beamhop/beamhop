# @beamhop/acp-ui

**Internal package.** React hooks + provider that wrap
[`@beamhop/acp-client`](../acp-client) so apps in this monorepo don't have to
re-implement the same subscribe/dispatch glue. Marked `private: true` — not
published to npm.

Consumed from source by the in-repo app(s) under `apps/`.

## Usage

Wrap your tree in `<AcpProvider>` with a live `AcpSession`:

```tsx
import { AcpProvider } from "@beamhop/acp-ui";
import { connectAcp } from "@beamhop/acp-client";

const session = await connectAcp({ /* ... */ });

<AcpProvider session={session}>
  <App />
</AcpProvider>
```

Inside the tree, use one of the typed hooks:

```tsx
import {
  useAcp,
  useAcpSession,
  useAgentSwitcher,
  usePermissionPrompts,
  useSlashCommands,
  useModelChooser,
} from "@beamhop/acp-ui";

function StatusBar() {
  const { status, sessionId, agentId, logs, lastError } = useAcpSession();
  return <span>{status} · {agentId}</span>;
}

function AgentPicker() {
  const { current, switching, switchTo } = useAgentSwitcher();
  // ...
}

function Composer() {
  const { match } = useSlashCommands();
  const matched = match(inputValue); // null when not in slash mode
  // ...
}

function ModelChip() {
  const { catalog, supported, switching, lastError, setModel } = useModelChooser();
  // ...
}
```

## Hooks

| Hook | Returns | Notes |
|---|---|---|
| `useAcp()` | `AcpSession` | Raw session from context. Throws if used outside `<AcpProvider>`. |
| `useAcpSession({ maxLogs? })` | `{ status, sessionId, agentId, availableAgents, lastError, logs }` | Subscribes to lifecycle events; logs are a rolling buffer. |
| `useAgentSwitcher()` | `{ current, switching, error, switchTo(id) }` | Wraps `session.switchAgent`. |
| `usePermissionPrompts()` | `{ pending, respond(decision), install }` | Wire `install` as `handlers.onPermissionRequest` in `connectAcp`; render a dialog driven by `pending`. |
| `useSlashCommands()` | `{ commands, match(input) }` | `match("/init")` returns matching commands or `null` when not in slash mode (past the first space, or no leading `/`). |
| `useModelChooser()` | `{ catalog, supported, switching, lastError, setModel(id) }` | Wraps `session.setModel`; `setModel` never throws — rejections land on `lastError` and the previous catalog stays. |

All hooks are race-safe under React 19 StrictMode: live state is read via
`useSyncExternalStore` so subscribe-vs-receive timings can't drop events.

## Provider

| Symbol | Notes |
|---|---|
| `AcpProvider` | `<AcpProvider session={...}>`. |
| `useAcp()` | Returns the session from context. Throws outside the provider. |
| `AcpProviderProps` | Type for `<AcpProvider>` props. |

## Types

| Symbol | Notes |
|---|---|
| `AcpStatus` | `"connecting" \| "ready" \| "reconnecting" \| "closed" \| "error"`. |
| `AcpSessionState` | Return shape of `useAcpSession`. |
| `UseAcpSessionOptions` | `{ maxLogs?: number }`. |
| `UseAgentSwitcherResult` | Return shape of `useAgentSwitcher`. |
| `PendingPrompt` | One queued permission request. |
| `UseSlashCommandsResult` | Return shape of `useSlashCommands`. |
| `UseModelChooserResult` | Return shape of `useModelChooser`. |

## License

Apache-2.0
