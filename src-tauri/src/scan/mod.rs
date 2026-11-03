//! 音楽ライブラリのスキャン。
//!
//! 1. scan    : スキャン対象フォルダ内の音楽ファイルを列挙する (platform::list_candidates)
//! 2. delete  : 設定に合わなくなったトラックを DB から消す (delete.rs)
//! 3. add     : 新しいファイルを LUFS=NULL のまま INSERT する (add.rs)
//! 4. LUFS    : バックグラウンドで LUFS / trailing_silence_ms を計算する (loudness.rs)
//! 5. 曲調タグ : LUFS の後に曲調を推定してタグを付ける (tone_tagging.rs)
//!
//! コマンドは 3 までを待って追加数と解析の依頼番号を返す。フロントは scan-progress で進捗を、
//! scan-analyze-completed (4 の完了) と tone-analyze-completed (5 の完了) で画面の更新時期を受け取る。
//!
//! スキャンが重なったとき (設定画面でのフォルダ追加など)
//! - 1〜3 は SCAN_LOCK で順番に行う。後のスキャンは 1〜3 が終わるのを待つだけなので、すぐに曲が増える
//! - 4 と 5 はそれぞれ 1 本だけ動かす。処理中に来た依頼はまとめて、終わった後にもう一周して拾う。
//!   5 は 1 曲数秒かかるので、5 の最中に追加された曲の 4 は 5 を待たずに始める。
//!   scan-analyze-completed はどの依頼番号までを解析したかを載せるので、フロントは自分の依頼が済んだかを判断できる

mod add;
mod delete;
mod loudness;
mod progress;
mod tone_tagging;

use crate::error::Result;
use crate::{db, platform, settings};
use progress::Progress;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use tauri::{AppHandle, Emitter};
use tauri_plugin_android_media::AndroidMediaExt;

#[derive(serde::Serialize)]
pub struct ScanResult {
    added: u64,
    /// 解析の依頼番号。解析しないときは 0
    analysis: u64,
}

#[tauri::command]
pub async fn music_scan_folders(app: AppHandle, paths: Vec<String>) -> Result<ScanResult> {
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
        move || {
            // 前のスキャンが panic していても、次のスキャンは走らせる
            let _guard = SCAN_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
            scan(&app, &db_path, &paths, min_duration_ms)
        }
    })
    .await??;

    let analysis = if analyze { request_analysis(app, db_path) } else { 0 };
    Ok(ScanResult { added, analysis })
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

static SCAN_LOCK: Mutex<()> = Mutex::new(());

static LOUDNESS: Worker = Worker::new();
static TONE: Worker = Worker::new();

/// 4 を依頼して依頼番号を返す。LUFS を付け終えたら scan-analyze-completed を送り、5 を依頼する。
fn request_analysis(app: AppHandle, db_path: PathBuf) -> u64 {
    let (done_app, done_db_path) = (app.clone(), db_path.clone());
    LOUDNESS.request(
        move || {
            if let Err(e) = crate::error::catch_panic(|| loudness::run(&app, &db_path)) {
                log::error!("loudness analysis failed: {e}");
            }
        },
        move |ticket| {
            // 失敗しても送り、フロントが解析中の表示のまま止まらないようにする
            let _ = done_app.emit("scan-analyze-completed", ticket);
            // 曲調の推定は LUFS を特徴量に使うので LUFS の後に回す
            let (app, db_path) = (done_app.clone(), done_db_path.clone());
            TONE.request(
                move || {
                    if let Err(e) = crate::error::catch_panic(|| tone_tagging::run(&app, &db_path)) {
                        log::error!("tone analysis failed: {e}");
                    }
                },
                |_| {},
            );
        },
    )
}

/// 依頼を 1 本のスレッドでまとめて処理する。
/// 各処理は始めた時点の未処理の曲だけを対象にするので、処理中に来た依頼は終わった後にもう一周して拾う。
struct Worker {
    state: Mutex<WorkerState>,
}

struct WorkerState {
    /// 最後に受けた依頼の番号
    requested: u64,
    running: bool,
}

impl Worker {
    const fn new() -> Self {
        Self { state: Mutex::new(WorkerState { requested: 0, running: false }) }
    }

    /// 依頼番号を返す。pass は一周分の処理、done はそれまでの依頼を全部終えたときに最後の番号で呼ぶ。
    /// 処理中のときは渡された pass と done は使わず、走っているスレッドがもう一周する。
    fn request(&'static self, pass: impl Fn() + Send + 'static, done: impl Fn(u64) + Send + 'static) -> u64 {
        let ticket = {
            let mut s = self.state.lock().unwrap();
            s.requested += 1;
            if s.running {
                return s.requested;
            }
            s.running = true;
            s.requested
        };
        tauri::async_runtime::spawn_blocking(move || loop {
            // ここまでの依頼で追加された曲は、全部この周の対象に入る
            let target = self.state.lock().unwrap().requested;
            pass();
            // 依頼の確認と running を下ろすのは同じロックの中で行う。分けると間に来た依頼を取りこぼす
            let mut s = self.state.lock().unwrap();
            if s.requested == target {
                s.running = false;
                drop(s);
                done(target);
                break;
            }
        });
        ticket
    }
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
