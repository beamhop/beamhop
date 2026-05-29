// Prevents an extra console window on Windows in release; ignored on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    beamhop_lib::run()
}
