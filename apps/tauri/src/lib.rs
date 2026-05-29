use std::sync::Mutex;

use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
struct HostProcess(Mutex<Option<CommandChild>>);

#[tauri::command]
fn host_port() -> u16 {
    5179
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(HostProcess::default())
        .invoke_handler(tauri::generate_handler![host_port])
        .setup(|app| {
            let resource_dir = match app.path().resource_dir() {
                Ok(p) => p,
                Err(err) => {
                    eprintln!("[host:fatal] resource_dir unavailable: {err}");
                    return Ok(());
                }
            };
            // tauri.conf.json declares `bundle.resources: ["resources/**/*"]`,
            // which preserves the `resources/` path prefix inside the .app's
            // Contents/Resources/ directory.
            let staged = resource_dir.join("resources");
            let host_dir = staged.join("host");
            let server_js = host_dir.join("server.js");
            let web_dir = staged.join("web").join("dist");

            eprintln!("[host:setup] cwd = {}", host_dir.display());
            eprintln!("[host:setup] js  = {}", server_js.display());
            eprintln!("[host:setup] web = {}", web_dir.display());

            // Surface staging/bundling failures loudly at startup. Without this
            // the sidecar spawn fails deep in the OS layer and the user just
            // sees a UI that never connects — much harder to diagnose. We log
            // and continue (the UI still renders so logs are capturable).
            let msb_bin = host_dir
                .join("node_modules")
                .join("@superradcompany")
                .join("microsandbox-darwin-arm64")
                .join("bin")
                .join("msb");
            for (label, path) in [
                ("server.js", &server_js),
                ("web dist", &web_dir),
                ("msb binary", &msb_bin),
            ] {
                if !path.exists() {
                    eprintln!(
                        "[host:startup] MISSING {label} at {} — the bundle is incomplete; \
                         the host will not function. Re-run `bun run prepare:tauri`.",
                        path.display()
                    );
                }
            }

            // Don't crash on missing sidecar / spawn failure — surface the
            // error in stderr and let the UI render so the user sees
            // *something* and can capture logs.
            let sidecar = match app.shell().sidecar("bun") {
                Ok(cmd) => cmd,
                Err(err) => {
                    eprintln!("[host:fatal] bun sidecar not found: {err}");
                    return Ok(());
                }
            };
            let spawned = sidecar
                .args(["server.js"])
                .current_dir(&host_dir)
                .env("BEAMHOP_WEB_DIR", web_dir.to_string_lossy().to_string())
                .spawn();
            let (mut rx, child) = match spawned {
                Ok(pair) => pair,
                Err(err) => {
                    eprintln!("[host:fatal] could not spawn bun sidecar: {err}");
                    return Ok(());
                }
            };

            let state: State<HostProcess> = app.state();
            *state.0.lock().unwrap() = Some(child);

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            eprintln!("[host] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[host:err] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(err) => {
                            eprintln!("[host:error] {err}");
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[host] terminated: {payload:?}");
                            break;
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(child) = app_handle
                    .state::<HostProcess>()
                    .0
                    .lock()
                    .unwrap()
                    .take()
                {
                    let _ = child.kill();
                }
            }
        });
}
