# @beamhop/desktop

The beamhop desktop host. A Tauri shell wrapping a Bun sidecar that runs the
HostOrchestrator (sandboxes + terminals + agents) and a React UI that drives it.

## Architecture

```
┌──────────── Tauri shell (Rust) ────────────┐
│                                            │
│  ┌────── Bun sidecar (child process) ────┐ │
│  │                                       │ │
│  │  HostOrchestrator                     │ │
│  │   ├─ beambox    (image builds)        │ │
│  │   ├─ sandbox-exec (run-in-microVM)    │ │
│  │   ├─ shell-server (PTY-over-P2P)      │ │
│  │   └─ acp-server  (agent CLI gateway)  │ │
│  │                                       │ │
│  │  WebSocket on 127.0.0.1:<random>      │ │
│  └───────────────────────────────────────┘ │
│                  ▲                         │
│                  │ JSON-RPC                │
│                  ▼                         │
│  ┌────────── WebView (React) ───────────┐  │
│  │  reads __BEAMHOP_SIDECAR_PORT__      │  │
│  │  three-panel UI: sandboxes/sessions  │  │
│  │   + live wterm pane                  │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

## Develop

You can run the pieces independently — useful when iterating on the UI alone.

```sh
# terminal A: start the sidecar (prints a ready line with its port)
bun run dev:sidecar
# →  {"ready":true,"port":59166}

# terminal B: start the UI dev server
bun run dev:ui
# →  desktop dev server: http://localhost:5175

# open http://localhost:5175/?sidecarPort=59166 in a browser
```

To run inside the Tauri shell (boots the sidecar automatically, injects the
port into the webview):

```sh
bun run tauri:dev
```

First run compiles the Rust deps and may take ~10 minutes; subsequent runs are
fast.

## Build (production)

```sh
bun run build           # builds both the sidecar bundle and the UI bundle
bun run tauri:build     # produces a platform-native .app / .exe / .deb / .dmg
```

## Test

End-to-end Playwright spec drives the UI against a real sidecar — boots an
alpine image, starts a terminal inside the microVM, types `uname -a`, asserts
`Linux` in the output:

```sh
RUN_INTEGRATION=1 bun test
```

(Skipped by default because it boots a real microsandbox.)
