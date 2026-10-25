//! 音楽ライブラリのスキャン。
//!
//! 1. scan    : スキャン対象フォルダ内の音楽ファイルを列挙する (platform::list_candidates)
//! 2. delete  : 設定に合わなくなったトラックを DB から消す (delete.rs)
//! 3. add     : 新しいファイルを LUFS=NULL のまま INSERT する (add.rs)
//! 4. LUFS    : バックグラウンドで LUFS / trailing_silence_ms を計算する (loudness.rs)
//! 5. 曲調タグ : LUFS の後に曲調を推定してタグを付ける (tone_tagging.rs)
//!
//! コマンドは 3 までを待って追加数を返す。フロントは scan-progress で進捗を、
//! scan-analyze-completed (4 の完了) と tone-analyze-completed (5 の完了) で画面の更新時期を受け取る。

mod add;
mod delete;
mod loudness;
mod progress;
mod tone_tagging;

use crate::error::Result;
use crate::{db, platform, settings};
use progress::Progress;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tauri_plugin_android_media::AndroidMediaExt;

#[tauri::command]
pub async fn music_scan_folders(app: AppHandle, paths: Vec<String>) -> Result<u64> {
    let config = settings::read_all(&app);
    let flag = |key: &str| config.get(key).and_then(|v| v.as_bool()).unwrap_or(false);
    // ignoreMode が ON なら ignoreTime 秒より短い曲を除く
    let min_duration_ms = flag("ignoreMode")
        .then(|| (config.get("ignoreTime").and_then(|v| v.as_f64()).unwrap_or(0.0) * 1000.0) as i64);
    // 開発者モードで disableAnalysingLoudness が ON のときだけ解析しない
    let analyze = !(flag("isDeveloperMode") && flag("disableAnalysingLoudness"));
    let db_path = db::path(&app)?;

    let added = tauri::async_runtime::spawn_blocking({
        let (app, db_path) = (app.clone(), db_path.clone());
        move || scan(&app, &db_path, &paths, min_duration_ms)
    })
    .await??;

    if analyze {
        spawn_analysis(app, db_path);
    } else {
        let _ = app.emit("scan-analyze-completed", ());
    }
    Ok(added)
}

/// 1〜3。追加したトラック数を返す。
fn scan(app: &AppHandle, db_path: &Path, folders: &[String], min_duration_ms: Option<i64>) -> Result<u64> {
    let mut conn = db::open(db_path)?;
    let progress = Progress::new(app);

    let candidates = platform::list_candidates(app, folders, |found, path| progress.scanning(found, path))?;

    progress.deleting();
    let deleted = delete::unmatched_tracks(&mut conn, folders, min_duration_ms, platform::existence(&candidates))?;

    let added = add::new_tracks(app, &mut conn, &candidates, min_duration_ms, &progress)?;
    progress.added(candidates.len());
    log::info!("scan: {} files, {deleted} deleted, {added} added", candidates.len());
    Ok(added)
}

/// 4 と 5 をバックグラウンドで順に行う。曲調の推定は LUFS を特徴量に使うので LUFS の後に回す。
fn spawn_analysis(app: AppHandle, db_path: PathBuf) {
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = crate::error::catch_panic(|| loudness::run(&app, &db_path)) {
            log::error!("loudness analysis failed: {e}");
        }
        // 失敗しても送り、フロントが解析中の表示のまま止まらないようにする
        let _ = app.emit("scan-analyze-completed", ());
        if let Err(e) = crate::error::catch_panic(|| tone_tagging::run(&app, &db_path)) {
            log::error!("tone analysis failed: {e}");
        }
    });
}

/// MediaStore に登録された音楽ファイルがあるフォルダの一覧 (Android のフォルダ選択用)。
/// デスクトップではプラグインが空の一覧を返す。
#[tauri::command]
pub fn android_list_audio_folders(app: AppHandle) -> Result<Vec<String>> {
    let metas = app.android_media().query_audio_metadata()?.items;
    let folders: std::collections::BTreeSet<String> = metas
        .iter()
        .filter_map(|m| Path::new(&m.display_path).parent()?.to_str().map(|s| s.to_string()))
        .collect();
    Ok(folders.into_iter().collect())
}
