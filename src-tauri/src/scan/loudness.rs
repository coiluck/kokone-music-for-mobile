// ---------------------------------------------------------------------------
// 4. calc LUFS : バックグラウンドで LUFS / trailing_silence_ms を計算
//
// lufs が NULL のトラックを拾って解析し、まとめて UPDATE する。
// ---------------------------------------------------------------------------

use super::progress::Progress;
use crate::analysis::loudness::{self, Loudness};
use crate::db;
use crate::error::{catch_panic, Result};
use crate::platform::{self, AudioFiles};
use rusqlite::params;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::AppHandle;

pub fn run(app: &AppHandle, db_path: &Path) -> Result<()> {
    let pending: Vec<(i64, String)> = db::open(db_path)?
        .prepare("SELECT id, path FROM tracks WHERE lufs IS NULL")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    if pending.is_empty() {
        return Ok(());
    }

    let files = AudioFiles::resolve(app, &pending.iter().map(|(_, p)| p.as_str()).collect::<Vec<_>>())?;
    let progress = Progress::new(app);
    let done = AtomicUsize::new(0);
    // SQLite への書き込みはシングルスレッドにまとめた方が速いので、結果を貯めて最後に書く
    let results: Mutex<Vec<(i64, Loudness)>> = Mutex::new(Vec::new());

    // 並列度 = max(論理CPU数 / 2, 4)
    let threads = std::cmp::max(num_cpus::get() / 2, 4);
    platform::for_each(&pending, threads, |(id, path)| {
        match catch_panic(|| loudness::analyze(files.open(path)?, &platform::extension(path))) {
            Ok(l) => results.lock().unwrap().push((*id, l)),
            Err(e) => log::warn!("loudness analysis failed for {path}: {e}"),
        }
        progress.analyzing(done.fetch_add(1, Ordering::Relaxed) + 1, pending.len(), path);
    })?;

    // 失敗した曲は NULL のまま残し、次回のスキャンで再試行する
    let mut conn = db::open(db_path)?;
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare("UPDATE tracks SET lufs = ?1, trailing_silence_ms = ?2 WHERE id = ?3")?;
        for (id, l) in results.lock().unwrap().iter() {
            if let Err(e) = stmt.execute(params![l.lufs, l.trailing_silence_ms as i64, id]) {
                log::warn!("UPDATE lufs failed for id={id}: {e}");
            }
        }
    }
    tx.commit()?;
    log::info!("loudness: analyzed {} of {} tracks", results.lock().unwrap().len(), pending.len());
    Ok(())
}
