// src-tauri/src/settings.rs
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// ── settings.json のパスを解決 ────────────────────────────
fn settings_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .expect("failed to resolve app config dir")
        .join("settings.json")
}

// ── JSON 全体を読む（ファイルがなければ空オブジェクト） ──
pub fn read_all(app: &AppHandle) -> Value {
    let path = settings_path(app);
    if !path.exists() {
        return json!({});
    }
    let text = fs::read_to_string(&path).unwrap_or_else(|_| "{}".into());
    serde_json::from_str(&text).unwrap_or_else(|_| json!({}))
}

// ── JSON 全体を書き戻す ───────────────────────────────────
fn write_all(app: &AppHandle, data: &Value) -> Result<(), String> {
    let path = settings_path(app);

    // 親ディレクトリがなければ作成
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

// ── Tauri コマンド: 値を取得 ──────────────────────────────
/// キーに対応する値を返す。
/// 値の型は呼び出し側（TypeScript）の型パラメータで決まる。
/// キーが存在しない場合は JSON null を返す。
#[tauri::command]
pub fn settings_get(app: AppHandle, key: String) -> Value {
    let data = read_all(&app);
    data.get(&key).cloned().unwrap_or(Value::Null)
}

// ── Tauri コマンド: 値を保存 ──────────────────────────────
/// キーと値（任意の JSON 値）を受け取って settings.json に保存する。
#[tauri::command]
pub fn settings_set(app: AppHandle, key: String, value: Value) -> Result<(), String> {
    let mut data = read_all(&app);

    // data が Object でなければ（壊れていたら）リセット
    if !data.is_object() {
        data = json!({});
    }

    data[key] = value;
    write_all(&app, &data)
}