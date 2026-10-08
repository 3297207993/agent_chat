// The commands the webview may invoke. Their permission files are generated from this list at build
// time, so a command missing here is a command the ACL rejects — the integration between `lib.rs` and
// `permissions/default.toml` is this constant.
const COMMANDS: &[&str] = &["module_url", "spawn", "kill", "call", "respond"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS).build();
}
