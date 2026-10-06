use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::Cambia;
#[cfg(mobile)]
use mobile::Cambia;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the cambia APIs.
pub trait CambiaExt<R: Runtime> {
  fn cambia(&self) -> &Cambia<R>;
}

impl<R: Runtime, T: Manager<R>> crate::CambiaExt<R> for T {
  fn cambia(&self) -> &Cambia<R> {
    self.state::<Cambia<R>>().inner()
  }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("cambia")
    .invoke_handler(tauri::generate_handler![commands::ping])
    .setup(|app, api| {
      #[cfg(mobile)]
      let cambia = mobile::init(app, api)?;
      #[cfg(desktop)]
      let cambia = desktop::init(app, api)?;
      app.manage(cambia);
      Ok(())
    })
    .build()
}
