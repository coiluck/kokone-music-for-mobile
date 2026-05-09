mod settings;
mod audio_analysis;
mod scan_music;
mod get_lang;
mod android_media;
mod music_playback;
mod edit_track;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_android_media::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
            settings::settings_get,
            settings::settings_set,
            get_lang::get_system_lang,
            scan_music::music_scan_folders,
            android_media::android_list_audio_folders,
            music_playback::music_read_file,
            edit_track::edit_track_metadata,
            music_playback::music_native_set_queue,
            music_playback::music_native_enqueue,
            music_playback::music_native_append_queue,
            music_playback::music_native_remove_at,
            music_playback::music_native_move,
            music_playback::music_native_clear,
            music_playback::music_native_next,
            music_playback::music_native_prev,
            music_playback::music_native_toggle_pause,
            music_playback::music_native_seek,
            music_playback::music_native_set_volume,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
