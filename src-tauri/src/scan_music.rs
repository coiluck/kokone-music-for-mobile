use crate::audio_analysis::{analyze_audio, analyze_trailing_silence};
use crate::settings;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, Tag};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

const SUPPORTED_EXTENSIONS: &[&str] = &["mp3", "flac", "ogg", "m4a", "aac", "wav"];

// 進捗イベントの最小送信間隔。ループ内での IPC 送信を間引くために使用する。
const EMIT_INTERVAL: Duration = Duration::from_millis(50);

// フロントに送る進捗
#[derive(Clone, serde::Serialize)]
struct ScanProgress {
    process_step: String, // "scanning" | "adding"
    scan_current: u64,
    scan_total: u64,
    add_current: u64,
    add_total: u64,
    current_file: String,
}

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

    // spawn_blocking に必要なものをすべてクローンして move
    let app_for_emit = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        // トランザクションを張るために mut で開く
        let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

        // WALモード
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;
             PRAGMA cache_size = -64000;
             PRAGMA busy_timeout = 5000;"
        ).map_err(|e| e.to_string())?;

        // IPC スロットル用のタイムスタンプ。
        // ループ内での emit は EMIT_INTERVAL 以上経過したときだけ送る。
        // 初期値を「過去」にしておくことで、最初の1件は即座に通知される。
        let mut last_emit = Instant::now()
            .checked_sub(EMIT_INTERVAL)
            .unwrap_or_else(Instant::now);

        // --- 1. 対象ファイルを先に列挙 ---
        let mut candidates: Vec<std::path::PathBuf> = Vec::new();
        for folder in &paths {
            for entry in WalkDir::new(folder).into_iter().filter_map(|e| e.ok()) {
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.into_path();
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
                  candidates.push(path.clone());

                  if last_emit.elapsed() >= EMIT_INTERVAL {
                      let _ = app_for_emit.emit("scan-progress", ScanProgress {
                          process_step: "scanning".into(),
                          scan_current: candidates.len() as u64,
                          scan_total: 0, // 列挙中は総数未確定
                          add_current: 0,
                          add_total: 0,
                          current_file: path
                              .file_name()
                              .and_then(|n| n.to_str())
                              .unwrap_or("")
                              .to_string(),
                      });
                      last_emit = Instant::now();
                  }
              }
          }
      }

        let file_count = candidates.len() as u64;
        let mut added = 0u64;
        let mut processed = 0u64;

        // --- ループ全体を一つのトランザクションで囲む ---
        // 1曲ごとの自動コミット(ディスクI/O)を避け、最後にまとめてcommitする。
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        for path in candidates {
            processed += 1;

            let path_str = match path.to_str() {
                Some(s) => s,
                None => continue,
            };

            // 進捗通知
            if last_emit.elapsed() >= EMIT_INTERVAL {
                let _ = app_for_emit.emit("scan-progress", ScanProgress {
                  process_step: "adding".into(),
                  scan_current: file_count,
                  scan_total: file_count,
                  add_current: processed,
                  add_total: file_count,
                  current_file: path
                      .file_name()
                      .and_then(|n| n.to_str())
                      .unwrap_or("")
                      .to_string(),
                });
                last_emit = Instant::now();
            }

            // --- 2. パス重複チェック ---
            let path_exists: bool = tx
                .query_row(
                    "SELECT COUNT(*) FROM tracks WHERE path = ?1",
                    params![path_str],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
                > 0;
            if path_exists {
                continue;
            }

            // --- 3. メタデータ取得（ハッシュ計算前に先読み）---
            // ignoreMode による短尺ファイル除外を、ハッシュ計算（全ファイル読み込み）より
            // 前に行うために、ここで lofty のタグ読み取りを実行する。
            // 以降のステップでもこの tagged を再利用する。
            let tagged = match Probe::open(&path).and_then(|p| p.read()) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let duration_ms = tagged.properties().duration().as_millis() as i64;
 
            if ignore_mode && (duration_ms as f64 / 1000.0) < ignore_time {
                continue;
            }
 
            // --- 4. ハッシュ計算 ---
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            let hash = if ext == "mp3" {
                match mp3_audio_hash(&path) {
                    Ok(h) => h,
                    Err(_) => continue,
                }
            } else {
                match file_hash(&path) {
                    Ok(h) => h,
                    Err(_) => continue,
                }
            };
 
            // --- 5. ハッシュ重複チェック（ここで弾いてからメタデータ・解析へ）---
            let hash_exists: bool = tx
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
 
            // --- 6. タグ値の取り出し ---
            let primary_tag = tagged.primary_tag();
            let title = primary_tag
                .and_then(|t| t.title())
                .map(|s| s.to_string())
                .or_else(|| {
                    path.file_stem()
                        .and_then(|s| s.to_str())
                        .map(|s| s.to_string())
                });
            let artist = primary_tag.and_then(|t| t.artist()).map(|s| s.to_string());
            let album = primary_tag.and_then(|t| t.album()).map(|s| s.to_string());
 
            // --- 7. オーディオ解析 ---
            // ReplayGainタグがあればLUFS計算をスキップし、末尾無音のみ計算する。
            // なければ従来通り analyze_audio でまとめて計算する。
            let (lufs, trailing_silence_ms): (Option<f64>, Option<i64>) =
                match primary_tag.and_then(read_replaygain_lufs) {
                    Some(rg_lufs) => {
                        // ReplayGainから復元したLUFSを採用。
                        // 末尾無音は末尾20秒のみ読むバージョンを使用。
                        let ts = analyze_trailing_silence(path_str)
                            .ok()
                            .map(|ms| ms as i64);
                        (Some(rg_lufs), ts)
                    }
                    None => {
                        // フォールバック: 従来通り全体をデコードして両方算出。
                        let analysis = analyze_audio(path_str).ok();
                        let lufs = analysis.as_ref().map(|a| a.lufs);
                        let ts = analysis.as_ref().map(|a| a.trailing_silence_ms as i64);
                        (lufs, ts)
                    }
                };
 
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
 
            match tx.execute(
                "INSERT INTO tracks \
                 (file_hash, path, title, artist, album, tags, duration_ms, lufs, trailing_silence_ms, scanned_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![hash, path_str, title, artist, album, "[]", duration_ms, lufs, trailing_silence_ms, now],
            ) {
                Ok(_) => added += 1,
                Err(e) => log::warn!("insert failed for {path_str}: {e}"),
            }
        }
 
        // --- トランザクションをコミット ---
        tx.commit().map_err(|e| e.to_string())?;
 
        // 完了通知（total と processed が揃った状態で current を空に）
        let _ = app_for_emit.emit("scan-progress", ScanProgress {
          process_step: "adding".into(),
          scan_current: file_count,
          scan_total: file_count,
          add_current: file_count,
          add_total: file_count,
          current_file: String::new(),
        });
 
        Ok(added)
    })
    .await
    .map_err(|e| e.to_string())?
}
 
fn mp3_audio_hash(path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    use std::io::{Read, Seek, SeekFrom};
 
    let mut file = std::fs::File::open(path)?;
    let file_len = file.metadata()?.len();
 
    // --- 先頭のID3v2ヘッダを読み取り、オーディオ開始位置を算出 ---
    let mut start: u64 = 0;
    if file_len >= 10 {
        let mut header = [0u8; 10];
        file.read_exact(&mut header)?;
        if &header[0..3] == b"ID3" {
            let flags = header[5];
            let sz = ((header[6] as u64) << 21)
                | ((header[7] as u64) << 14)
                | ((header[8] as u64) << 7)
                | (header[9] as u64);
            let has_footer = (flags & 0x10) != 0;
            start = (10 + sz + if has_footer { 10 } else { 0 }).min(file_len);
        }
    }
 
    // --- 末尾のID3v1(TAG)の有無を確認し、オーディオ終了位置を算出 ---
    let mut end: u64 = file_len;
    if file_len >= 128 {
        file.seek(SeekFrom::Start(file_len - 128))?;
        let mut tag_marker = [0u8; 3];
        file.read_exact(&mut tag_marker)?;
        if &tag_marker == b"TAG" {
            end = file_len - 128;
        }
    }
 
    // --- オーディオ本体をチャンク単位でハッシュ化 ---
    let mut h = Sha256::new();
    if start < end {
        file.seek(SeekFrom::Start(start))?;
        let mut remaining = end - start;
        let mut buf = [0u8; 65536];
        while remaining > 0 {
            let to_read = remaining.min(buf.len() as u64) as usize;
            let n = file.read(&mut buf[..to_read])?;
            if n == 0 {
                break; // EOF (通常ここには来ないが安全のため)
            }
            h.update(&buf[..n]);
            remaining -= n as u64;
        }
    }
 
    Ok(format!("{:x}", h.finalize()))
}
 
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
 
/// ReplayGain タグから推定LUFSを取得する。
///
/// `REPLAYGAIN_TRACK_GAIN` は参照レベルに合わせるためのゲイン値(dB)なので、
/// 参照レベル(-18 LUFS, ReplayGain 2.0準拠)を基準に
/// `LUFS = -18.0 - track_gain_db` で元のラウドネスを逆算する。
///
/// 値は `"-6.50 dB"` `"-6.50"` `"- 6.50dB"` のような表記ゆれがあるため、
/// 数値部分だけを抽出してパースする。
/// タグが無い、または値が不正な場合は None を返す。
fn read_replaygain_lufs(tag: &Tag) -> Option<f64> {
    const REFERENCE_LUFS: f64 = -18.0;
 
    let raw = tag.get_string(&ItemKey::ReplayGainTrackGain)?;
 
    // "dB" を取り除き、先頭の数値部分だけを抽出
    let cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-' || *c == '+')
        .collect();
 
    let gain_db: f64 = cleaned.parse().ok()?;
    Some(REFERENCE_LUFS - gain_db)
}