// A real Tauri application with Cambia wired in, used as the reference for what a host must do **and**
// as K2.4's ignition experiment.
//
// Three things a host must get right, and this file is where two of them live (the third is the CSP in
// `tauri.conf.json`):
//
// 1. **The plugin root is the host's decision.** `Builder::plugin_root` has no default on purpose
//    (docs/design/tauri-plugin-cambia.md): a default computed inside the adapter would be a second
//    authority for something that must have exactly one.
// 2. **The root is only knowable after the app exists**, because it comes from the path resolver. That
//    is why the plugin is registered from `setup` through `AppHandle::plugin` instead of
//    `Builder::plugin` — the same reason a real host cannot hard-code the path.
//
// `ignition_log` is the experiment's recorder, not a feature: the webview runs the load sequence on
// startup, and every step is appended to `<app_data_dir>/ignition.log` so the result can be read after
// the window closes (a `console.log` would only be visible in a devtools window).

use std::io::Write;

use tauri::{command, AppHandle, Manager, Runtime};

/// Append one line to the ignition log, next to the plugin root.
#[command]
fn ignition_log<R: Runtime>(app: AppHandle<R>, line: String) -> Result<(), String> {
  let path = app
    .path()
    .app_data_dir()
    .map_err(|error| error.to_string())?
    .join("ignition.log");

  if let Some(dir) = path.parent() {
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
  }

  let mut file = std::fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(&path)
    .map_err(|error| error.to_string())?;

  writeln!(file, "{line}").map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![ignition_log])
    .setup(|app| {
      let root = app.path().app_data_dir()?.join("plugins");

      // The experiment needs to know where to put the fixture; a real host would not log this.
      println!("cambia: plugin root = {}", root.display());

      // `log_dir` is where the backends' stderr goes, one file per instance
      // (`<plugin>/<generation>.log`).
      app.handle().plugin(
        tauri_plugin_cambia::Builder::new()
          .plugin_root(root.clone())
          .log_dir(root.join(".logs"))
          .build(),
      )?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
