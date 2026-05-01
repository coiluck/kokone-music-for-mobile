// 再生用にトラックのファイルパスを「再生可能な形」で返す。
//
// desktop: 既にローカルファイルなので、DB の path をそのまま返す。
//
// Android: MediaStore の content:// URI を WebView の HTTP 配信経由で
//   HTMLAudioElement に食わせると Range リクエストが正しく動かず 30 秒前後で
//   停止するため、Kotlin 側で cacheDir にコピーしてからそのパスを返す。
//   キャッシュは LRU で 10 ファイル / 200MB に制限される (Kotlin 側で管理)。
//
// フロントは music_read_file でこのパスを Vec<u8> として読み出し、
// AudioContext.decodeAudioData() でデコードして再生する。

use rusqlite::Connection;
use std::path::Path;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "android")]
use tauri_plugin_android_media::{AndroidMediaExt, PrepareAudioRequest};

#[tauri::command]
pub async fn music_prepare_track(app: AppHandle, track_id: i64) -> Result<String, String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("music.db");

    // DB から path を引く
    let (path, _audio_id_unused): (String, ()) = {
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        let path: String = conn
            .query_row(
                "SELECT path FROM tracks WHERE id = ?1",
                [track_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        (path, ())
    };

    #[cfg(not(target_os = "android"))]
    {
        return Ok(path);
    }

    #[cfg(target_os = "android")]
    {
        // MediaStore から audio_id を引き直す。
        // DB には MediaStore の id を直接は持っていないので、display_path 一致で探す。
        let metas = crate::android_media::query_audio_metadata(&app)?;
        let meta = metas
            .into_iter()
            .find(|m| m.display_path == path)
            .ok_or_else(|| format!("track not found in MediaStore: {path}"))?;

        let ext = Path::new(&path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin")
            .to_lowercase();

        let resp = app
            .android_media()
            .prepare_audio(PrepareAudioRequest {
                audio_id: meta.id,
                ext,
            })
            .map_err(|e| e.to_string())?;

        if resp.path.is_empty() {
            return Err("prepare_audio returned empty path".into());
        }
        Ok(resp.path)
    }
}

// 指定された絶対パスのファイル全体を読み出して返す。
// フロントの AudioContext.decodeAudioData() に直接食わせる用途。
#[tauri::command]
pub async fn music_read_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("read failed for {path}: {e}"))
}