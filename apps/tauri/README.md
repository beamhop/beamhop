# tauri (desktop shell)

Placeholder for the Tauri-based desktop wrapper.

## Status

Not implemented yet. The directory exists so that
`bun run build:host` has a stable place to drop the compiled host
binary:

```
apps/tauri/binaries/pi-rpc-host
```

When the Tauri shell lands, it will:

1. Ship `pi-rpc-host` as a sidecar binary.
2. Spawn it on launch.
3. Load `apps/web/dist/` (or the bundled equivalent) in the webview.

For now this folder is empty by design — don't add a `package.json`
until the shell is real, otherwise `bun install` will try to wire it
into the workspace graph.
