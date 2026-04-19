mod settings;
mod audio_analysis;
mod scan_music;
mod get_lang;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            settings::settings_get,
            settings::settings_set,
            get_lang::get_system_lang,
            scan_music::music_scan_folders,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
