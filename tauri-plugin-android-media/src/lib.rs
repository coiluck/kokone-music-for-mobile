use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(not(target_os = "android"))]
mod desktop;
#[cfg(target_os = "android")]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(not(target_os = "android"))]
use desktop::AndroidMedia;
#[cfg(target_os = "android")]
use mobile::AndroidMedia;

/// Extension trait to access the AndroidMedia API from a Tauri AppHandle / Manager.
pub trait AndroidMediaExt<R: Runtime> {
    fn android_media(&self) -> &AndroidMedia<R>;
}

impl<R: Runtime, T: Manager<R>> AndroidMediaExt<R> for T {
    fn android_media(&self) -> &AndroidMedia<R> {
        self.state::<AndroidMedia<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-media")
        .invoke_handler(tauri::generate_handler![
            commands::has_audio_permission,
            commands::request_audio_permission,
            commands::query_audio_metadata,
            commands::audio_hash,
        ])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let android_media = mobile::init(app, api)?;
            #[cfg(not(target_os = "android"))]
            let android_media = desktop::init(app, api)?;
            app.manage(android_media);
            Ok(())
        })
        .build()
}
