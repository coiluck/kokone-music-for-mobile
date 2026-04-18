use sys_locale::get_locale;

#[tauri::command]
pub fn get_system_lang() -> String {
    let locale = get_locale().unwrap_or_else(|| "en".to_string());
    // "ja-JP" → "ja" に丸める
    locale.split('-').next().unwrap_or("en").to_string()
}