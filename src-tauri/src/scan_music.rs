#[cfg(not(target_os = "android"))]
use crate::audio_analysis::analyze_audio;
use crate::settings;
#[cfg(not(target_os = "android"))]
use lofty::prelude::*;
#[cfg(not(target_os = "android"))]
use lofty::probe::Probe;
#[cfg(not(target_os = "android"))]
use rayon::prelude::*;
use rusqlite::{params, Connection};
#[cfg(not(target_os = "android"))]
use sha2::{Digest, Sha256};
use std::collections::HashSet;
#[cfg(not(target_os = "android"))]
use std::io::Read;
use std::path::{Path, PathBuf};
#[cfg(not(target_os = "android"))]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(not(target_os = "android"))]
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

        // ===== 1. scan + 3. add =====
        // Android では scoped storage によりファイル直接 open ができない場合があるため、
        // MediaStore からメタデータをまとめて取得し、ハッシュも Kotlin 側で計算する
        // 専用フローを使う。desktop は従来通り walkdir + lofty + sha2。
        #[cfg(target_os = "android")]
        let (file_count, added) = {
            let metas = enumerate_android_candidates(&scan_paths, &app_for_emit, &mut last_emit);

            // ===== 2. detect delete =====
            let _ = app_for_emit.emit("scan-progress", ScanProgress::empty("deleting"));
            delete_unmatched_tracks(&mut conn, &scan_paths, ignore_mode, ignore_time, &app_for_emit)
                .map_err(|e| e.to_string())?;

            let added = add_new_tracks_android(
                &mut conn,
                &metas,
                ignore_mode,
                ignore_time,
                &app_for_emit,
                &mut last_emit,
            )?;
            (metas.len() as u64, added)
        };

        #[cfg(not(target_os = "android"))]
        let (file_count, added) = {
            let candidates =
                enumerate_candidates(&scan_paths, &app_for_emit, &mut last_emit);

            // ===== 2. detect delete =====
            let _ = app_for_emit.emit("scan-progress", ScanProgress::empty("deleting"));
            delete_unmatched_tracks(&mut conn, &scan_paths, ignore_mode, ignore_time, &app_for_emit)
                .map_err(|e| e.to_string())?;

            let added = add_new_tracks(
                &mut conn,
                &candidates,
                ignore_mode,
                ignore_time,
                &app_for_emit,
                &mut last_emit,
            )?;
            (candidates.len() as u64, added)
        };

        // add 完了時点でフロントに完了通知を送る。
        // ここで scanVersion を上げて画面を一旦更新する想定。
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

// Android では filesystem を直接スキャンせず、MediaStore に登録済みの音楽を
// メタデータ込みで取得して、scan_folders で指定されたフォルダ配下にあるものだけ拾う。
// 「scan-folder = フォルダパス」というセマンティクスは desktop と統一。
//
// scoped storage 環境では Rust から /storage/emulated/0/... を直接 fopen できないので、
// Rust 側ではファイル本体を一切触らず、Kotlin から得たメタデータと audio_id で
// add_new_tracks_android が処理する。
#[cfg(target_os = "android")]
fn enumerate_android_candidates(
    paths: &[String],
    app: &AppHandle,
    last_emit: &mut Instant,
) -> Vec<crate::android_media::AndroidAudioMeta> {
    let all_audio = match crate::android_media::query_audio_metadata(app) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("MediaStore query failed: {e}");
            return Vec::new();
        }
    };

    let mut candidates: Vec<crate::android_media::AndroidAudioMeta> = Vec::new();
    for meta in all_audio {
        let in_scan_folder = paths.iter().any(|f| meta.display_path.starts_with(f));
        if !in_scan_folder {
            continue;
        }

        let ext = std::path::Path::new(&meta.display_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }

        let display_name = meta.display_name.clone();
        candidates.push(meta);

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
                    current_file: display_name,
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
#[cfg_attr(not(target_os = "android"), allow(unused_variables))]
fn delete_unmatched_tracks(
    conn: &mut Connection,
    scan_folders: &[String],
    ignore_mode: bool,
    ignore_time: f64,
    app: &AppHandle,
) -> Result<u64, rusqlite::Error> {
    // Android では Rust 側からファイル存在確認 (is_file) ができない
    // (scoped storage により EACCES が返り、is_file は false 扱いになるので
    // 全トラックが「不存在」と誤判定されて全削除される)。
    // 代わりに MediaStore に現在登録されているパスの集合を取って、
    // それに含まれないものを「削除済み」とみなす。
    // クエリ自体に失敗した場合は誤削除を避けるため「全部存在する」とみなす。
    #[cfg(target_os = "android")]
    let (media_paths, media_query_ok): (std::collections::HashSet<String>, bool) =
        match crate::android_media::query_audio_metadata(app) {
            Ok(metas) => (metas.into_iter().map(|m| m.display_path).collect(), true),
            Err(e) => {
                log::warn!("MediaStore query failed in delete_unmatched_tracks: {e}");
                (std::collections::HashSet::new(), false)
            }
        };

    // 削除対象 id の収集はトランザクションの外でやる
    // (prepare 中の stmt の生存期間と tx の借用が衝突するのを避けるため)
    let to_delete: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT id, path, duration_ms FROM tracks")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        })?;

        let mut v: Vec<i64> = Vec::new();
        let ignore_ms = (ignore_time * 1000.0) as i64;

        for row in rows {
            let (id, path, duration_ms) = row?;

            // (a) スキャンフォルダ外 or 実ファイルが存在しない
            let in_scan_folder = scan_folders.iter().any(|f| path.starts_with(f));

            #[cfg(not(target_os = "android"))]
            let exists = Path::new(&path).is_file();
            #[cfg(target_os = "android")]
            let exists = if media_query_ok {
                media_paths.contains(&path)
            } else {
                // MediaStore 取得に失敗した場合は誤削除を避けるため「存在する」とみなす。
                true
            };

            if !in_scan_folder || !exists {
                v.push(id);
                continue;
            }

            // (b) ignoreMode が ON で、duration_ms が基準秒数未満
            if ignore_mode {
                if let Some(d) = duration_ms {
                    if d < ignore_ms {
                        v.push(id);
                        continue;
                    }
                }
            }
        }
        v
    };

    if to_delete.is_empty() {
        return Ok(0);
    }

    // tracks / history / playlists を同じトランザクションで更新する。
    // 途中で失敗して playlist だけ虫食いになるのを避けるため。
    let tx = conn.transaction()?;

    let mut deleted: u64 = 0;

    // チャンクに分けて DELETE（SQLITE_MAX_VARIABLE_NUMBER 対策）
    // history.track_id が tracks.id を参照しているため、FK 制約違反を避けるべく
    // 参照元の history を先に消してから tracks を消す。
    for chunk in to_delete.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let params_vec: Vec<&dyn rusqlite::ToSql> =
            chunk.iter().map(|id| id as &dyn rusqlite::ToSql).collect();

        let history_sql = format!("DELETE FROM history WHERE track_id IN ({})", placeholders);
        tx.execute(&history_sql, params_vec.as_slice())?;

        let tracks_sql = format!("DELETE FROM tracks WHERE id IN ({})", placeholders);
        deleted += tx.execute(&tracks_sql, params_vec.as_slice())? as u64;
    }

    // playlists.tracks (JSON 配列) からも削除対象 id を除去する。
    //
    // 削除対象を temp テーブルに入れて、JSON1 の json_each で配列を展開し、
    // NOT IN で残すものだけ json_group_array で再構築する。
    // 空配列で json_group_array が NULL になるケースは COALESCE で '[]' にフォールバック。
    tx.execute(
        "CREATE TEMP TABLE IF NOT EXISTS _deleted_track_ids (id INTEGER PRIMARY KEY)",
        [],
    )?;
    // 前回スキャンの残骸が残っているとマズいので毎回クリア
    tx.execute("DELETE FROM _deleted_track_ids", [])?;
    {
        let mut stmt = tx.prepare("INSERT INTO _deleted_track_ids (id) VALUES (?1)")?;
        for id in &to_delete {
            stmt.execute(params![id])?;
        }
    }

    // 削除対象 id を含む playlist だけ UPDATE する (全 playlist 舐めないよう EXISTS でフィルタ)
    tx.execute(
        "UPDATE playlists
            SET tracks = COALESCE(
                (SELECT json_group_array(value)
                   FROM json_each(playlists.tracks)
                  WHERE value NOT IN (SELECT id FROM _deleted_track_ids)),
                '[]'
            )
          WHERE EXISTS (
            SELECT 1 FROM json_each(playlists.tracks)
             WHERE value IN (SELECT id FROM _deleted_track_ids)
          )",
        [],
    )?;

    tx.execute("DELETE FROM _deleted_track_ids", [])?;

    tx.commit()?;
    Ok(deleted)
}

// ---------------------------------------------------------------------------
// 3. add : 新規ファイルを LUFS=NULL のまま INSERT
//
// 重複チェックは事前に HashSet にロードしてオンメモリで判定する。
// 旧実装はループ内で `SELECT COUNT(*) WHERE path=?` を毎回叩いていたため
// 数千〜数万曲規模で N+1 になっていた。
//
// desktop 専用。Android は add_new_tracks_android を使う。
// ---------------------------------------------------------------------------
#[cfg(not(target_os = "android"))]
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

// ---------------------------------------------------------------------------
// 3. add : Android 版
//
// scoped storage により Rust 側からファイルを直接 fopen できないため、
//   - メタデータは MediaStore のものをそのまま使う
//   - ハッシュは Kotlin 側で ContentResolver.openFileDescriptor 経由で計算
// ---------------------------------------------------------------------------
#[cfg(target_os = "android")]
fn add_new_tracks_android(
    conn: &mut Connection,
    metas: &[crate::android_media::AndroidAudioMeta],
    ignore_mode: bool,
    ignore_time: f64,
    app: &AppHandle,
    last_emit: &mut Instant,
) -> Result<u64, String> {
    let (mut existing_paths, mut existing_hashes) =
        load_existing_keys(conn).map_err(|e| e.to_string())?;

    let file_count = metas.len() as u64;
    let mut added = 0u64;
    let mut processed = 0u64;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for meta in metas {
        processed += 1;

        // 進捗通知 (スロットル)
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
                    current_file: meta.display_name.clone(),
                },
            );
            *last_emit = Instant::now();
        }

        // パス重複チェック
        if existing_paths.contains(&meta.display_path) {
            continue;
        }

        // ignoreMode フィルタ
        let duration_ms = meta.duration_ms;
        if ignore_mode && (duration_ms as f64 / 1000.0) < ignore_time {
            continue;
        }

        // ハッシュ計算 (Kotlin 側に委譲)
        let ext = std::path::Path::new(&meta.display_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        let is_mp3 = ext == "mp3";
        let hash = match crate::android_media::audio_hash(app, meta.id, is_mp3) {
            Ok(h) if !h.is_empty() => h,
            Ok(_) => {
                log::warn!("audio_hash returned empty for id={}", meta.id);
                continue;
            }
            Err(e) => {
                log::warn!("audio_hash failed for id={}: {e}", meta.id);
                continue;
            }
        };

        if existing_hashes.contains(&hash) {
            continue;
        }

        // タグ値 (MediaStore から取得済み)。
        // タイトルが空ならファイル名から、それも無ければ "Unknown"。
        let title = if !meta.title.is_empty() {
            meta.title.clone()
        } else {
            std::path::Path::new(&meta.display_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown".to_string())
        };
        let artist = if meta.artist.is_empty() {
            None
        } else {
            Some(meta.artist.clone())
        };
        let album = if meta.album.is_empty() {
            None
        } else {
            Some(meta.album.clone())
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        match tx.execute(
            "INSERT INTO tracks \
             (file_hash, path, title, artist, album, tags, duration_ms, lufs, trailing_silence_ms, scanned_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, ?8)",
            params![hash, meta.display_path, title, artist, album, "[]", duration_ms, now],
        ) {
            Ok(_) => {
                added += 1;
                existing_paths.insert(meta.display_path.clone());
                existing_hashes.insert(hash);
            }
            Err(e) => log::warn!("insert failed for {}: {e}", meta.display_path),
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
// Android では scoped storage により Rust 側から直接 fopen できないため、
// 現状 LUFS 解析はスキップする (将来的には Kotlin 側で fd を取得して
// 解析する仕組みに置き換える予定)。即座に「完了」イベントだけ発火する。
#[cfg(target_os = "android")]
fn spawn_lufs_analysis(app: AppHandle, _db_path: PathBuf) {
    tauri::async_runtime::spawn_blocking(move || {
        let _ = app.emit("scan-analyze-completed", ());
    });
}

#[cfg(not(target_os = "android"))]
fn spawn_lufs_analysis(app: AppHandle, db_path: PathBuf) {
    tauri::async_runtime::spawn_blocking(move || {
        // analyze_audio は内部で std::fs::File::open を使うため、
        // 何らかの理由で panic した場合にプロセスを巻き込まないよう catch_unwind で守る。
        let app_for_recover = app.clone();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_lufs_analysis(app, db_path)
        }));
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => log::warn!("LUFS analysis failed: {e}"),
            Err(_) => {
                log::error!("LUFS analysis panicked");
                let _ = app_for_recover.emit("scan-analyze-completed", ());
            }
        }
    });
}

#[cfg(not(target_os = "android"))]
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
// ハッシュ計算 (desktop 専用)
// Android では Kotlin 側の MediaStoreHelper.audioHash を使う。
// ---------------------------------------------------------------------------
#[cfg(not(target_os = "android"))]
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

#[cfg(not(target_os = "android"))]
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