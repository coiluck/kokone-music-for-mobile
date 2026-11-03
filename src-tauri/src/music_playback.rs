// 再生制御:
//
// desktop: JS の HTMLAudioElement で再生するので、ファイル全体を返す music_read_file だけを使う。
//
// Android: Media3 (ExoPlayer + MediaSessionService) を使用。
//   ExoPlayer は MediaStore の content:// URI を直接扱えるので、ここでは
//   track_id を MediaStore audio_id に解決して PlaybackQueueItem を組み立てるだけ。
//   再生 (queue 管理 / next / prev / pause / 通知 / ロック画面 / Bluetooth) は
//   すべて Kotlin 側の MediaSessionService に丸投げする。
//
// music_native_* はデスクトップでは呼ばれない (JS が Android のときだけ呼ぶ)。
// プラグインのデスクトップ実装は何もしないので、コマンドはプラットフォームで分けない。

use crate::db;
use crate::error::Result;
use rusqlite::Connection;
use std::collections::HashMap;
use tauri::ipc::Response;
use tauri::AppHandle;
use tauri_plugin_android_media::{
    AndroidMediaExt, AudioIdsForPathsRequest, PlaybackAppendQueueRequest, PlaybackEnqueueRequest,
    PlaybackIndexRequest, PlaybackMoveRequest, PlaybackQueueItem, PlaybackSeekRequest,
    PlaybackSetQueueRequest, PlaybackVolumeRequest,
};

const TARGET_LUFS: f64 = -14.0;

struct TrackForPlayback {
    path: String,
    title: String,
    artist: String,
    lufs: Option<f64>,
}

fn fetch_track(conn: &Connection, track_id: i64) -> Result<TrackForPlayback> {
    Ok(conn.query_row("SELECT path, title, artist, lufs FROM tracks WHERE id = ?1", [track_id], |row| {
        Ok(TrackForPlayback {
            path: row.get(0)?,
            title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            artist: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            lufs: row.get(3)?,
        })
    })?)
}

fn lufs_to_gain(lufs: Option<f64>) -> f32 {
    match lufs {
        Some(v) if v.is_finite() => 10f64.powf((TARGET_LUFS - v) / 20.0) as f32,
        _ => 1.0,
    }
}

#[tauri::command]
pub async fn music_read_file(app: AppHandle, track_id: i64) -> Result<Response> {
    let track = fetch_track(&db::open(&db::path(&app)?)?, track_id)?;
    let bytes = std::fs::read(&track.path).map_err(|e| format!("read failed for {}: {e}", track.path))?;
    Ok(Response::new(bytes))
}

// -----------------------------------------------------------------------------
// Android 用: ネイティブサービスにキューを渡すコマンド群
//
// JS から呼ばれるエントリポイント。フロントは「キューに入れる Track の ID 配列」
// と startIndex を渡してくる。Rust 側で DB lookup を行い、
// QueueItem を組み立ててからプラグイン経由でサービスに送る。
// -----------------------------------------------------------------------------

fn lookup_audio_ids(app: &AppHandle, paths: Vec<String>) -> Result<HashMap<String, i64>> {
    if paths.is_empty() {
        return Ok(HashMap::new());
    }
    // 全件スキャンを避けて WHERE _DATA IN (...) で必要な path だけ問い合わせる。
    Ok(app.android_media().audio_ids_for_paths(AudioIdsForPathsRequest { paths })?.ids)
}

fn build_items_for(app: &AppHandle, track_ids: &[i64]) -> Result<Vec<PlaybackQueueItem>> {
    // 1. SQLite からトラック情報を引く
    let conn = db::open(&db::path(app)?)?;
    let mut tracks = Vec::with_capacity(track_ids.len());
    for &id in track_ids {
        match fetch_track(&conn, id) {
            Ok(t) => tracks.push((id, t)),
            Err(e) => log::warn!("fetch_track failed for {id}: {e}"),
        }
    }
    // 2. 集めた path をまとめて Kotlin に audio_id 解決を依頼 (1 回の JNI)
    let id_map = lookup_audio_ids(app, tracks.iter().map(|(_, t)| t.path.clone()).collect())?;
    // 3. PlaybackQueueItem を組み立てる
    let mut items = Vec::with_capacity(tracks.len());
    for (track_id, track) in tracks {
        match id_map.get(&track.path) {
            Some(&audio_id) => items.push(PlaybackQueueItem {
                track_id,
                audio_id,
                title: track.title,
                artist: track.artist,
                gain: lufs_to_gain(track.lufs),
            }),
            None => log::warn!("not in MediaStore: {}", track.path),
        }
    }
    Ok(items)
}

#[tauri::command]
pub async fn music_native_set_queue(app: AppHandle, track_ids: Vec<i64>, start_index: i32) -> Result<()> {
    let items = build_items_for(&app, &track_ids)?;
    app.android_media().playback_set_queue(PlaybackSetQueueRequest { items, start_index })?;
    Ok(())
}

#[tauri::command]
pub async fn music_native_enqueue(app: AppHandle, track_id: i64) -> Result<()> {
    let item = build_items_for(&app, &[track_id])?.pop().ok_or_else(|| format!("track {track_id} not in MediaStore"))?;
    app.android_media().playback_enqueue(PlaybackEnqueueRequest { item })?;
    Ok(())
}

/// 既に再生開始済みのキューに残り曲を末尾追加する。
/// JS は `play()` の中で最初の 1 曲が走り出した直後にこれを呼ぶ。
#[tauri::command]
pub async fn music_native_append_queue(app: AppHandle, track_ids: Vec<i64>) -> Result<()> {
    let items = build_items_for(&app, &track_ids)?;
    if !items.is_empty() {
        app.android_media().playback_append_queue(PlaybackAppendQueueRequest { items })?;
    }
    Ok(())
}

#[tauri::command]
pub async fn music_native_remove_at(app: AppHandle, index: i32) -> Result<()> {
    app.android_media().playback_remove_at(PlaybackIndexRequest { index })?;
    Ok(())
}

#[tauri::command]
pub async fn music_native_move(app: AppHandle, from: i32, to: i32) -> Result<()> {
    app.android_media().playback_move(PlaybackMoveRequest { from, to })?;
    Ok(())
}

#[tauri::command]
pub async fn music_native_clear(app: AppHandle) -> Result<()> {
    app.android_media().playback_clear()?;
    Ok(())
}

#[tauri::command]
pub async fn music_native_next(app: AppHandle) -> Result<()> {
    app.android_media().playback_next()?;
    Ok(())
}

#[tauri::command]
pub async fn music_native_prev(app: AppHandle) -> Result<()> {
    app.android_media().playback_prev()?;
    Ok(())
}

#[tauri::command]
pub async fn music_native_toggle_pause(app: AppHandle) -> Result<()> {
    app.android_media().playback_toggle_pause()?;
    Ok(())
}

#[tauri::command]
pub async fn music_native_seek(app: AppHandle, position_ms: i64) -> Result<()> {
    app.android_media().playback_seek(PlaybackSeekRequest { position_ms })?;
    Ok(())
}

#[tauri::command]
pub async fn music_native_set_volume(app: AppHandle, volume: f32, normalize: bool) -> Result<()> {
    app.android_media().playback_set_volume(PlaybackVolumeRequest { volume, normalize })?;
    Ok(())
}
