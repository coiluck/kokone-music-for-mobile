use crate::audio_analysis::analyze_audio;
use crate::settings;
use lofty::prelude::*;
use lofty::probe::Probe;
use rayon::prelude::*;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
#[cfg(not(target_os = "android"))]
use walkdir::WalkDir;

const SUPPORTED_EXTENSIONS: &[&str] = &["mp3", "flac", "ogg", "m4a", "aac", "wav"];

// 進捗イベントの最小送信間隔。ループ内での IPC 送信を間引くために使用する。
const EMIT_INTERVAL: Duration = Duration::from_millis(50);

// フロントに送る進捗
//
// process_step は以下の4段階。
//   "scanning"  : ファイル列挙中
//   "deleting"  : 設定に適合しなくなったトラックをDBから削除中
//   "adding"    : 新規ファイルを INSERT 中（LUFS等は NULL のまま）
//   "analyzing" : バックグラウンドで LUFS / trailing_silence_ms を計算中
#[derive(Clone, serde::Serialize)]
struct ScanProgress {
    process_step: String,
    scan_current: u64,
    scan_total: u64,
    add_current: u64,
    add_total: u64,
    analyze_current: u64,
    analyze_total: u64,
    current_file: String,
}

impl ScanProgress {
    fn empty(step: &str) -> Self {
        Self {
            process_step: step.into(),
            scan_current: 0,
            scan_total: 0,
            add_current: 0,
            add_total: 0,
            analyze_current: 0,
            analyze_total: 0,
            current_file: String::new(),
        }
    }
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
    let app_for_bg = app.clone();
    let db_path_for_bg = db_path.clone();
    let scan_paths = paths.clone();

    let added = tauri::async_runtime::spawn_blocking(move || -> Result<u64, String> {
        let mut conn = open_db(&db_path)?;

        // IPC スロットル用のタイムスタンプ。
        // ループ内での emit は EMIT_INTERVAL 以上経過したときだけ送る。
        // 初期値を「過去」にしておくことで、最初の1件は即座に通知される。
        let mut last_emit = Instant::now()
            .checked_sub(EMIT_INTERVAL)
            .unwrap_or_else(Instant::now);

        // ===== 1. scan : 対象ファイルを列挙 =====
        let candidates =
            enumerate_candidates(&scan_paths, &app_for_emit, &mut last_emit);

        // ===== 2. detect delete : 設定に適合しないトラックをDBから削除 =====
        let _ = app_for_emit.emit("scan-progress", ScanProgress::empty("deleting"));
        delete_unmatched_tracks(&conn, &scan_paths, ignore_mode, ignore_time)
            .map_err(|e| e.to_string())?;

        // ===== 3. add : 新規ファイルを LUFS=NULL で INSERT =====
        let added = add_new_tracks(
            &mut conn,
            &candidates,
            ignore_mode,
            ignore_time,
            &app_for_emit,
            &mut last_emit,
        )?;

        // add 完了時点でフロントに完了通知を送る。
        // ここで scanVersion を上げて画面を一旦更新する想定。
        let file_count = candidates.len() as u64;
        let _ = app_for_emit.emit(
            "scan-progress",
            ScanProgress {
                process_step: "adding".into(),
                scan_current: file_count,
                scan_total: file_count,
                add_current: file_count,
                add_total: file_count,
                analyze_current: 0,
                analyze_total: 0,
                current_file: String::new(),
            },
        );

        Ok(added)
    })
    .await
    .map_err(|e| e.to_string())??;

    // ===== 4. calc LUFS : バックグラウンドで LUFS を計算して書き戻し =====
    // add の完了通知後、解析は別タスクで非同期に走らせる。
    // フロントは scan-progress("analyzing") と scan-analyze-completed で状況を受け取る。
    spawn_lufs_analysis(app_for_bg, db_path_for_bg);

    Ok(added)
}

/// 起動時などに、LUFS が NULL のまま残っているトラックを拾って解析する。
/// 新規スキャンと独立して呼べるよう、別コマンドとして公開する。
#[tauri::command]
pub async fn music_analyze_pending(app: AppHandle) -> Result<(), String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("music.db");

    spawn_lufs_analysis(app, db_path);
    Ok(())
}

// ---------------------------------------------------------------------------
// DB 初期化
// ---------------------------------------------------------------------------
fn open_db(db_path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA temp_store = MEMORY;
         PRAGMA cache_size = -64000;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

// ---------------------------------------------------------------------------
// 1. scan : 対象ファイル列挙
//
// プラットフォームごとに列挙方法が違うが、戻り値は同じ「絶対パスの Vec」。
// scan-folder は常に「フォルダパス文字列」として扱う。
// ---------------------------------------------------------------------------
#[cfg(not(target_os = "android"))]
fn enumerate_candidates(
    paths: &[String],
    app: &AppHandle,
    last_emit: &mut Instant,
) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for folder in paths {
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
            if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
                continue;
            }
            candidates.push(path.clone());

            if last_emit.elapsed() >= EMIT_INTERVAL {
                let _ = app.emit(
                    "scan-progress",
                    ScanProgress {
                        process_step: "scanning".into(),
                        scan_current: candidates.len() as u64,
                        scan_total: 0, // 列挙中は総数未確定
                        add_current: 0,
                        add_total: 0,
                        analyze_current: 0,
                        analyze_total: 0,
                        current_file: path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string(),
                    },
                );
                *last_emit = Instant::now();
            }
        }
    }
    candidates
}

// Android では filesystem を直接スキャンせず、MediaStore に登録済みの音楽を取得して
// scan_folders で指定されたフォルダ配下にあるものだけ拾う。
// 「scan-folder = フォルダパス」というセマンティクスは desktop と統一。
#[cfg(target_os = "android")]
fn enumerate_candidates(
    paths: &[String],
    app: &AppHandle,
    last_emit: &mut Instant,
) -> Vec<PathBuf> {
    let all_audio = match crate::android_media::query_audio_files() {
        Ok(v) => v,
        Err(e) => {
            log::warn!("MediaStore query failed: {e}");
            return Vec::new();
        }
    };

    let mut candidates: Vec<PathBuf> = Vec::new();
    for path_str in all_audio {
        let in_scan_folder = paths.iter().any(|f| path_str.starts_with(f));
        if !in_scan_folder {
            continue;
        }

        let path = PathBuf::from(&path_str);
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }
        candidates.push(path.clone());

        if last_emit.elapsed() >= EMIT_INTERVAL {
            let _ = app.emit(
                "scan-progress",
                ScanProgress {
                    process_step: "scanning".into(),
                    scan_current: candidates.len() as u64,
                    scan_total: 0,
                    add_current: 0,
                    add_total: 0,
                    analyze_current: 0,
                    analyze_total: 0,
                    current_file: path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string(),
                },
            );
            *last_emit = Instant::now();
        }
    }
    candidates
}

// ---------------------------------------------------------------------------
// 2. detect delete : 設定に適合しないトラックを DB から削除
//
//   - スキャン対象フォルダ外のパスになったトラック
//     （フォルダがリストから外された、またはファイル自体が移動/削除された）
//   - ignoreMode が ON で、duration_ms が基準秒数未満のトラック
// ---------------------------------------------------------------------------
fn delete_unmatched_tracks(
    conn: &Connection,
    scan_folders: &[String],
    ignore_mode: bool,
    ignore_time: f64,
) -> Result<u64, rusqlite::Error> {
    // 全トラックの (id, path, duration_ms) を取得
    let mut stmt = conn.prepare("SELECT id, path, duration_ms FROM tracks")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<i64>>(2)?,
        ))
    })?;

    // 削除対象 id を収集
    let mut to_delete: Vec<i64> = Vec::new();
    let ignore_ms = (ignore_time * 1000.0) as i64;

    for row in rows {
        let (id, path, duration_ms) = row?;

        // (a) スキャンフォルダ外 or 実ファイルが存在しない
        let in_scan_folder = scan_folders.iter().any(|f| path.starts_with(f));
        let exists = Path::new(&path).is_file();
        if !in_scan_folder || !exists {
            to_delete.push(id);
            continue;
        }

        // (b) ignoreMode が ON で、duration_ms が基準秒数未満
        if ignore_mode {
            if let Some(d) = duration_ms {
                if d < ignore_ms {
                    to_delete.push(id);
                    continue;
                }
            }
        }
    }
    drop(stmt);

    if to_delete.is_empty() {
        return Ok(0);
    }

    // チャンクに分けて DELETE（SQLITE_MAX_VARIABLE_NUMBER 対策）
    let mut deleted: u64 = 0;
    for chunk in to_delete.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!("DELETE FROM tracks WHERE id IN ({})", placeholders);
        let params_vec: Vec<&dyn rusqlite::ToSql> =
            chunk.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        deleted += conn.execute(&sql, params_vec.as_slice())? as u64;
    }
    Ok(deleted)
}

// ---------------------------------------------------------------------------
// 3. add : 新規ファイルを LUFS=NULL のまま INSERT
//
// 重複チェックは事前に HashSet にロードしてオンメモリで判定する。
// 旧実装はループ内で `SELECT COUNT(*) WHERE path=?` を毎回叩いていたため
// 数千〜数万曲規模で N+1 になっていた。
// ---------------------------------------------------------------------------
fn add_new_tracks(
    conn: &mut Connection,
    candidates: &[PathBuf],
    ignore_mode: bool,
    ignore_time: f64,
    app: &AppHandle,
    last_emit: &mut Instant,
) -> Result<u64, String> {
    // --- 既存 path / file_hash を一括ロード ---
    // INSERT で衝突しても困らないよう、ループ中に追加された分も HashSet に加えていく。
    let (mut existing_paths, mut existing_hashes) =
        load_existing_keys(conn).map_err(|e| e.to_string())?;

    let file_count = candidates.len() as u64;
    let mut added = 0u64;
    let mut processed = 0u64;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for path in candidates {
        processed += 1;

        let path_str = match path.to_str() {
            Some(s) => s,
            None => continue,
        };

        // 進捗通知
        if last_emit.elapsed() >= EMIT_INTERVAL {
            let _ = app.emit(
                "scan-progress",
                ScanProgress {
                    process_step: "adding".into(),
                    scan_current: file_count,
                    scan_total: file_count,
                    add_current: processed,
                    add_total: file_count,
                    analyze_current: 0,
                    analyze_total: 0,
                    current_file: path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string(),
                },
            );
            *last_emit = Instant::now();
        }

        // パス重複チェック（オンメモリ）
        if existing_paths.contains(path_str) {
            continue;
        }

        // メタデータ取得（ハッシュ計算前に先読み）
        let tagged = match Probe::open(path).and_then(|p| p.read()) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let duration_ms = tagged.properties().duration().as_millis() as i64;

        if ignore_mode && (duration_ms as f64 / 1000.0) < ignore_time {
            continue;
        }

        // ハッシュ計算
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
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

        // ハッシュ重複チェック（オンメモリ）
        if existing_hashes.contains(&hash) {
            continue;
        }

        // タグ値の取り出し
        let primary_tag = tagged.primary_tag();
        let title = primary_tag
            .and_then(|t| t.title())
            .map(|s| s.to_string())
            .or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "Unknown".to_string());
        let artist = primary_tag.and_then(|t| t.artist()).map(|s| s.to_string());
        let album = primary_tag.and_then(|t| t.album()).map(|s| s.to_string());

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        // LUFS と trailing_silence_ms は NULL のまま登録。
        // バックグラウンドの解析タスクが後から UPDATE する。
        match tx.execute(
            "INSERT INTO tracks \
             (file_hash, path, title, artist, album, tags, duration_ms, lufs, trailing_silence_ms, scanned_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, ?8)",
            params![hash, path_str, title, artist, album, "[]", duration_ms, now],
        ) {
            Ok(_) => {
                added += 1;
                // 同一スキャン中の重複（同じパスが複数回現れるケースは無いが、
                // 別ファイルが同じハッシュを持つケースに備えて)
                existing_paths.insert(path_str.to_string());
                existing_hashes.insert(hash);
            }
            Err(e) => log::warn!("insert failed for {path_str}: {e}"),
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(added)
}

/// 既存トラックの path と file_hash を HashSet に一括ロードする。
/// `add_new_tracks` のループでオンメモリ重複チェックに使う。
fn load_existing_keys(
    conn: &Connection,
) -> Result<(HashSet<String>, HashSet<String>), rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT path, file_hash FROM tracks")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut paths: HashSet<String> = HashSet::new();
    let mut hashes: HashSet<String> = HashSet::new();
    for r in rows {
        let (p, h) = r?;
        paths.insert(p);
        hashes.insert(h);
    }
    Ok((paths, hashes))
}

// ---------------------------------------------------------------------------
// 4. calc LUFS : バックグラウンドで LUFS / trailing_silence_ms を計算
//
// 並列度 = max(論理CPU数 / 2, 4)。rayon の thread pool を使う。
// LUFS が NULL のトラックを全件拾って解析し、UPDATE する。
// ---------------------------------------------------------------------------
fn spawn_lufs_analysis(app: AppHandle, db_path: PathBuf) {
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = run_lufs_analysis(app, db_path) {
            log::warn!("LUFS analysis failed: {e}");
        }
    });
}

fn run_lufs_analysis(app: AppHandle, db_path: PathBuf) -> Result<(), String> {
    // 解析対象（LUFS が NULL のトラック）を取得
    let pending: Vec<(i64, String)> = {
        let conn = open_db(&db_path)?;
        let mut stmt = conn
            .prepare("SELECT id, path FROM tracks WHERE lufs IS NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut v = Vec::new();
        for r in rows {
            if let Ok(t) = r {
                v.push(t);
            }
        }
        v
    };

    if pending.is_empty() {
        let _ = app.emit("scan-analyze-completed", ());
        return Ok(());
    }

    let total = pending.len() as u64;

    // 並列度 = max(論理CPU数 / 2, 4)
    let logical = num_cpus::get();
    let threads = std::cmp::max(logical / 2, 4);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build()
        .map_err(|e| e.to_string())?;

    let progress = AtomicU64::new(0);
    let last_emit = Mutex::new(
        Instant::now()
            .checked_sub(EMIT_INTERVAL)
            .unwrap_or_else(Instant::now),
    );

    // (id, lufs, trailing_silence_ms) を集めて、最後にまとめて UPDATE する。
    // SQLite への書き込みはシングルスレッドにまとめた方が速いので
    // 解析結果は Mutex<Vec<...>> に貯めるだけにする。
    let results: Mutex<Vec<(i64, Option<f64>, Option<i64>)>> = Mutex::new(Vec::new());

    pool.install(|| {
        pending.par_iter().for_each(|(id, path)| {
            // タグからの読み出しはやめて、すべて analyze_audio で算出する。
            let (lufs, ts_ms) = match analyze_audio(path) {
                Ok(a) => (Some(a.lufs), Some(a.trailing_silence_ms as i64)),
                Err(e) => {
                    log::warn!("analyze_audio failed for {path}: {e}");
                    (None, None)
                }
            };

            results.lock().unwrap().push((*id, lufs, ts_ms));

            let done = progress.fetch_add(1, Ordering::Relaxed) + 1;

            // 進捗通知（スロットル）
            let mut le = last_emit.lock().unwrap();
            if le.elapsed() >= EMIT_INTERVAL || done == total {
                let _ = app.emit(
                    "scan-progress",
                    ScanProgress {
                        process_step: "analyzing".into(),
                        scan_current: 0,
                        scan_total: 0,
                        add_current: 0,
                        add_total: 0,
                        analyze_current: done,
                        analyze_total: total,
                        current_file: Path::new(path)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string(),
                    },
                );
                *le = Instant::now();
            }
        });
    });

    // 解析結果をまとめて DB に書き戻す
    let mut conn = open_db(&db_path)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("UPDATE tracks SET lufs = ?1, trailing_silence_ms = ?2 WHERE id = ?3")
            .map_err(|e| e.to_string())?;
        for (id, lufs, ts) in results.lock().unwrap().iter() {
            if let Err(e) = stmt.execute(params![lufs, ts, id]) {
                log::warn!("UPDATE lufs failed for id={id}: {e}");
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    // 完了通知
    let _ = app.emit(
        "scan-progress",
        ScanProgress {
            process_step: "analyzing".into(),
            scan_current: 0,
            scan_total: 0,
            add_current: 0,
            add_total: 0,
            analyze_current: total,
            analyze_total: total,
            current_file: String::new(),
        },
    );
    let _ = app.emit("scan-analyze-completed", ());

    Ok(())
}

// ---------------------------------------------------------------------------
// ハッシュ計算（変更なし）
// ---------------------------------------------------------------------------
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
