use crate::audio_analysis::analyze_audio;
use crate::settings;
use lofty::prelude::*;
use lofty::probe::Probe;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

const SUPPORTED_EXTENSIONS: &[&str] = &["mp3", "flac", "ogg", "m4a", "aac", "wav"];

#[tauri::command]
pub async fn music_scan_folders(app: AppHandle, paths: Vec<String>) -> Result<u64, String> {
    let config = settings::read_all(&app);
    let ignore_mode = config
        .get("ignoreMode")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let ignore_time = config
        .get("ignoreTime")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("music.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let mut added = 0u64;

    for folder in &paths {
        for entry in WalkDir::new(folder).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
                continue;
            }
            let path_str = match path.to_str() {
                Some(s) => s,
                None => continue,
            };

            // すでにDBに同じパスのトラックがあればスキップ
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM tracks WHERE path = ?1",
                    params![path_str],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
                > 0;
            if exists {
                continue;
            }

            // メタデータ・再生時間を取得
            let tagged = match Probe::open(path).and_then(|p| p.read()) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let duration_ms = tagged.properties().duration().as_millis() as i64;

            // ignoreMode: ignoreTime 秒未満はスキップ
            if ignore_mode && (duration_ms as f64 / 1000.0) < ignore_time {
                continue;
            }

            let primary_tag = tagged.primary_tag();
            let title = primary_tag
            .and_then(|t| t.title())
            .map(|s| s.to_string())
            .or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            });
            let artist = primary_tag
                .and_then(|t| t.artist())
                .map(|s| s.to_string());
            let album = primary_tag
                .and_then(|t| t.album())
                .map(|s| s.to_string());

            // SHA256 計算（MP3はID3タグを除いたオーディオ部分のみ）
            let hash = if ext == "mp3" {
                match mp3_audio_hash(path) {
                    Ok(h) => h,
                    Err(_) => continue,
                }
            } else {
                match file_hash(path) {
                    Ok(h) => h,
                    Err(_) => continue,
                }
            };

            // 同一ハッシュが既にDBにあればスキップ
            let hash_exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM tracks WHERE file_hash = ?1",
                    params![hash],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
                > 0;
            if hash_exists {
                continue;
            }

            // オーディオ解析（LUFS・末尾無音）
            let analysis = analyze_audio(path_str).ok();
            let lufs = analysis.as_ref().map(|a| a.lufs);
            let trailing_silence_ms = analysis.as_ref().map(|a| a.trailing_silence_ms as i64);

            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;

            match conn.execute(
                "INSERT INTO tracks \
                 (file_hash, path, title, artist, album, tags, duration_ms, lufs, trailing_silence_ms, scanned_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    hash,
                    path_str,
                    title,
                    artist,
                    album,
                    "[]",
                    duration_ms,
                    lufs,
                    trailing_silence_ms,
                    now,
                ],
            ) {
                Ok(_) => added += 1,
                Err(e) => log::warn!("insert failed for {path_str}: {e}"),
            }
        }
    }

    Ok(added)
}

// MP3: ID3v2（先頭）と ID3v1（末尾128バイト）を除いたオーディオ部分をハッシュ
fn mp3_audio_hash(path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    let data = std::fs::read(path)?;
    let mut start = 0usize;
    let mut end = data.len();

    if data.len() >= 10 && &data[0..3] == b"ID3" {
        let flags = data[5];
        // syncsafe integer (各バイト上位1ビットは0)
        let sz = ((data[6] as usize) << 21)
            | ((data[7] as usize) << 14)
            | ((data[8] as usize) << 7)
            | (data[9] as usize);
        let has_footer = (flags & 0x10) != 0;
        start = (10 + sz + if has_footer { 10 } else { 0 }).min(data.len());
    }

    if data.len() >= 128 && &data[data.len() - 128..data.len() - 125] == b"TAG" {
        end = data.len() - 128;
    }

    let audio = if start < end { &data[start..end] } else { &data[..] };
    let mut h = Sha256::new();
    h.update(audio);
    Ok(format!("{:x}", h.finalize()))
}

// それ以外のフォーマット: ファイル全体をハッシュ
fn file_hash(path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    let mut file = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
