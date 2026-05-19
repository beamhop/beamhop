// Beamhop desktop Tauri shell.
//
// The sidecar is launched by Tauri's `beforeDevCommand` (dev) /
// `beforeBuildCommand` lifecycle hooks, NOT by us — so we don't need to
// fight macOS's launchctl PATH or parse stdout. The webview discovers the
// sidecar's port via `DEV_SIDECAR_PORT` baked into the bundled JS (see
// src/lib/sidecar-client.ts).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
