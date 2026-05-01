// 再生用にトラックのファイル全体を Vec<u8> として読み出す。
//
// desktop: DB の path をそのまま fs::read で読む。
//
// Android: MediaStore の content:// URI は直接開けないため、
//   Kotlin 側で cacheDir にコピーしてから (prepare_audio)、
//   コピー済みのパスを fs::read で読む。
//   キャッシュは LRU で 10 ファイル / 200MB に制限される (Kotlin 側で管理)。
//
// フロント側はこの Vec<u8> を Blob にし、URL.createObjectURL で
// Blob URL を作って <audio>.src にセットする。Tauri 〜 WebView 間の
// HTTP プロキシを経由しないため、Android Range request バグ
// (tauri-apps/tauri#12019) の影響を受けない。

use rusqlite::Connection;
use tauri::{ipc::Response, AppHandle, Manager};

#[cfg(target_os = "android")]
use std::path::Path;
#[cfg(target_os = "android")]
use tauri_plugin_android_media::{AndroidMediaExt, PrepareAudioRequest};

fn resolve_playable_path(app: &AppHandle, track_id: i64) -> Result<String, String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("music.db");

    let path: String = {
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT path FROM tracks WHERE id = ?1",
            [track_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?
    };

    #[cfg(not(target_os = "android"))]
    {
        return Ok(path);
    }

    #[cfg(target_os = "android")]
    {
        // MediaStore から audio_id を引き直す。
        // DB には MediaStore の id を直接は持っていないので、display_path 一致で探す。
        let metas = crate::android_media::query_audio_metadata(app)?;
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

#[tauri::command]
pub async fn music_read_file(app: AppHandle, track_id: i64) -> Result<Response, String> {
    let path = resolve_playable_path(&app, track_id)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("read failed for {path}: {e}"))?;
    Ok(Response::new(bytes))
}
