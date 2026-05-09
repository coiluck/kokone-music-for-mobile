// 再生制御:
//
// desktop: 従来どおり JS の HTMLAudioElement 経由で再生するため、
//   ファイル全体を Vec<u8> で返す music_read_file をそのまま提供する。
//
// Android: Media3 (ExoPlayer + MediaSessionService) を使用。
//   ExoPlayer は MediaStore の content:// URI を直接扱えるので、ここでは
//   track_id を MediaStore audio_id に解決して PlaybackQueueItem を組み立てるだけ。
//   再生 (queue 管理 / next / prev / pause / 通知 / ロック画面 / Bluetooth) は
//   すべて Kotlin 側の MediaSessionService に丸投げする。

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "android")]
use tauri_plugin_android_media::{AndroidMediaExt, PlaybackQueueItem, PlaybackSetQueueRequest};

#[cfg(not(target_os = "android"))]
use tauri::ipc::Response;

// -----------------------------------------------------------------------------
// 共通: DB から 1 トラックの再生用メタを取り出す
// -----------------------------------------------------------------------------

struct TrackForPlayback {
    path: String,
    title: String,
    artist: String,
    lufs: Option<f64>,
}

fn fetch_track(app: &AppHandle, track_id: i64) -> Result<TrackForPlayback, String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("music.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT path, title, artist, lufs FROM tracks WHERE id = ?1",
        [track_id],
        |row| {
            Ok(TrackForPlayback {
                path: row.get(0)?,
                title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                artist: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                lufs: row.get(3)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

const TARGET_LUFS: f64 = -14.0;

fn lufs_to_gain(lufs: Option<f64>) -> f32 {
    match lufs {
        Some(v) if v.is_finite() => 10f64.powf((TARGET_LUFS - v) / 20.0) as f32,
        _ => 1.0,
    }
}

// -----------------------------------------------------------------------------
// desktop 用: 従来の Vec<u8> 経路
// -----------------------------------------------------------------------------

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn music_read_file(app: AppHandle, track_id: i64) -> Result<Response, String> {
    let track = fetch_track(&app, track_id)?;
    let bytes = std::fs::read(&track.path)
        .map_err(|e| format!("read failed for {}: {e}", track.path))?;
    Ok(Response::new(bytes))
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn music_read_file(_app: AppHandle, _track_id: i64) -> Result<Vec<u8>, String> {
    Err("music_read_file is desktop-only".into())
}

// -----------------------------------------------------------------------------
// Android 用: ネイティブサービスにキューを渡すコマンド群
//
// JS から呼ばれるエントリポイント。フロントは「キューに入れる Track の ID 配列」
// と startIndex を渡してくる。Rust 側で DB lookup と prepare_audio を行い、
// QueueItem を組み立ててからプラグイン経由でサービスに送る。
// -----------------------------------------------------------------------------

#[cfg(target_os = "android")]
fn build_queue_item(
    track_id: i64,
    path_to_audio_id: &std::collections::HashMap<String, i64>,
    track: &TrackForPlayback,
) -> Result<PlaybackQueueItem, String> {
    let audio_id = *path_to_audio_id
        .get(&track.path)
        .ok_or_else(|| format!("track not found in MediaStore: {}", track.path))?;
    Ok(PlaybackQueueItem {
        track_id,
        audio_id,
        title: track.title.clone(),
        artist: track.artist.clone(),
        gain: lufs_to_gain(track.lufs),
    })
}

#[cfg(target_os = "android")]
fn build_path_index(app: &AppHandle) -> Result<std::collections::HashMap<String, i64>, String> {
    // MediaStore の全件スキャンは重いので、setQueue 1 回につき 1 度だけ呼ぶ。
    let metas = crate::android_media::query_audio_metadata(app)?;
    Ok(metas
        .into_iter()
        .map(|m| (m.display_path, m.id))
        .collect())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn music_native_set_queue(
    app: AppHandle,
    track_ids: Vec<i64>,
    start_index: i32,
) -> Result<(), String> {
    let path_index = build_path_index(&app)?;
    let mut items = Vec::with_capacity(track_ids.len());
    for id in track_ids {
        match fetch_track(&app, id) {
            Ok(track) => match build_queue_item(id, &path_index, &track) {
                Ok(it) => items.push(it),
                Err(e) => eprintln!("[music_native_set_queue] skip track {id}: {e}"),
            },
            Err(e) => eprintln!("[music_native_set_queue] fetch_track failed for {id}: {e}"),
        }
    }
    app.android_media()
        .playback_set_queue(PlaybackSetQueueRequest { items, start_index })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn music_native_enqueue(app: AppHandle, track_id: i64) -> Result<(), String> {
    let path_index = build_path_index(&app)?;
    let track = fetch_track(&app, track_id)?;
    let item = build_queue_item(track_id, &path_index, &track)?;
    app.android_media()
        .playback_enqueue(tauri_plugin_android_media::PlaybackEnqueueRequest { item })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn music_native_remove_at(app: AppHandle, index: i32) -> Result<(), String> {
    app.android_media()
        .playback_remove_at(tauri_plugin_android_media::PlaybackIndexRequest { index })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn music_native_move(app: AppHandle, from: i32, to: i32) -> Result<(), String> {
    app.android_media()
        .playback_move(tauri_plugin_android_media::PlaybackMoveRequest { from, to })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn music_native_clear(app: AppHandle) -> Result<(), String> {
    app.android_media().playback_clear().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn music_native_next(app: AppHandle) -> Result<(), String> {
    app.android_media().playback_next().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn music_native_prev(app: AppHandle) -> Result<(), String> {
    app.android_media().playback_prev().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn music_native_toggle_pause(app: AppHandle) -> Result<(), String> {
    app.android_media().playback_toggle_pause().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn music_native_seek(app: AppHandle, position_ms: i64) -> Result<(), String> {
    app.android_media()
        .playback_seek(tauri_plugin_android_media::PlaybackSeekRequest { position_ms })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn music_native_set_volume(app: AppHandle, volume: f32) -> Result<(), String> {
    app.android_media()
        .playback_set_volume(tauri_plugin_android_media::PlaybackVolumeRequest { volume })
        .map_err(|e| e.to_string())?;
    Ok(())
}

// -----------------------------------------------------------------------------
// 非 Android プラットフォームに対する空実装。invoke_handler の宣言を
// プラットフォームで分岐させたくないので、no-op を返すだけのスタブを置く。
// JS 側は android かどうかで呼び分けるので、デスクトップで呼ばれることはない。
// -----------------------------------------------------------------------------

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn music_native_set_queue(
    _app: AppHandle,
    _track_ids: Vec<i64>,
    _start_index: i32,
) -> Result<(), String> { Ok(()) }

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn music_native_enqueue(_app: AppHandle, _track_id: i64) -> Result<(), String> { Ok(()) }

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn music_native_remove_at(_app: AppHandle, _index: i32) -> Result<(), String> { Ok(()) }

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn music_native_move(_app: AppHandle, _from: i32, _to: i32) -> Result<(), String> { Ok(()) }

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn music_native_clear(_app: AppHandle) -> Result<(), String> { Ok(()) }

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn music_native_next(_app: AppHandle) -> Result<(), String> { Ok(()) }

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn music_native_prev(_app: AppHandle) -> Result<(), String> { Ok(()) }

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn music_native_toggle_pause(_app: AppHandle) -> Result<(), String> { Ok(()) }

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn music_native_seek(_app: AppHandle, _position_ms: i64) -> Result<(), String> { Ok(()) }

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn music_native_set_volume(_app: AppHandle, _volume: f32) -> Result<(), String> { Ok(()) }