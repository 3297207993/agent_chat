// A real Tauri application with Cambia wired in, used as the reference for what a host has to do.
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
// What this does **not** do yet: load a plugin. Enumerating what is installed (K2.5) and turning a
// plugin into the path `moduleURL` expects (K2.4) are still missing, so a plugin would have to be placed
// by hand under `<app_data_dir>/plugins/<id>/<version>-<hash>/`. Running this app and watching
// `import()` succeed is K2.4's ignition test.

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let root = app.path().app_data_dir()?.join("plugins");

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
