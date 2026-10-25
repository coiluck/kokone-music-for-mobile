// ---------------------------------------------------------------------------
// 5. 曲調タグ : LUFS 解析の後に、energy_score が NULL のトラックの曲調を推定する。
//
// スコアは tracks.energy_score / mood_score に保存し、曲調タグ (ENERGY_TAGS / MOOD_TAGS) が
// まだ 1 つも付いていない曲にだけ推定タグを追加する。ユーザーが付けたタグは上書きしない。
// 解析が重い (1 曲数秒) ので、途中で終了しても結果が残るよう 1 曲ごとに書き込む。
// ---------------------------------------------------------------------------

use crate::scan_music::open_db;
use crate::tone_analysis::{Tone, ENERGY_TAGS, MOOD_TAGS};
use rusqlite::{params, params_from_iter, Connection};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

struct Pending {
    id: i64,
    path: String,
    lufs: Option<f64>,
}

pub fn run(app: &AppHandle, db_path: &Path) -> Result<(), String> {
    let conn = open_db(db_path)?;
    let pending: Vec<Pending> = conn
        .prepare("SELECT id, path, lufs FROM tracks WHERE energy_score IS NULL")
        .map_err(|e| e.to_string())?
        .query_map([], |row| Ok(Pending { id: row.get(0)?, path: row.get(1)?, lufs: row.get(2)? }))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    if pending.is_empty() {
        return Ok(());
    }
    let conn = Mutex::new(conn);
    analyze_all(app, &pending, &conn)?;
    let _ = app.emit("tone-analyze-completed", ());
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn analyze_all(_app: &AppHandle, pending: &[Pending], conn: &Mutex<Connection>) -> Result<(), String> {
    use rayon::prelude::*;
    // 1 曲あたり 100MB 程度使うので、LUFS 解析より並列度を抑える
    let threads = (num_cpus::get() / 2).clamp(1, 4);
    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads).build().map_err(|e| e.to_string())?;
    pool.install(|| {
        pending.par_iter().for_each(|t| {
            let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| crate::tone_analysis::analyze_file(&t.path, t.lufs)))
                .unwrap_or_else(|_| Err("panicked".into()));
            save(conn, t, res);
        })
    });
    Ok(())
}

// fd 取得は JNI 経由なので、LUFS 解析と同じく逐次で行う。
#[cfg(target_os = "android")]
fn analyze_all(app: &AppHandle, pending: &[Pending], conn: &Mutex<Connection>) -> Result<(), String> {
    let id_map = crate::android_media::audio_ids_for_paths(app, pending.iter().map(|t| t.path.clone()).collect())?;
    for t in pending {
        let Some(&audio_id) = id_map.get(&t.path) else {
            log::warn!("no MediaStore id for {}, skipping tone analysis", t.path);
            continue;
        };
        let ext = Path::new(&t.path).extension().and_then(|e| e.to_str()).unwrap_or("");
        let res = crate::android_media::open_audio_fd(app, audio_id).and_then(|fd| {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| crate::tone_analysis::analyze_fd(fd, ext, t.lufs)))
                .unwrap_or_else(|_| Err("panicked".into()))
        });
        save(conn, t, res);
    }
    Ok(())
}

/// スコアを保存し、曲調タグが未設定ならタグを追加する。
/// タグの判定と追加を 1 つの UPDATE で行い、読み込みから書き込みの間にフロントで編集されたタグを消さないようにする。
fn save(conn: &Mutex<Connection>, t: &Pending, res: Result<Tone, String>) {
    let tone = match res {
        Ok(tone) => tone,
        Err(e) => {
            log::warn!("tone analysis failed for {}: {e}", t.path);
            return;
        }
    };
    let conn = conn.lock().unwrap();
    let r = conn
        .execute(
            "UPDATE tracks SET energy_score = ?1, mood_score = ?2 WHERE id = ?3",
            params![tone.energy_score, tone.mood_score, t.id],
        )
        .and_then(|_| add_tag_if_missing(&conn, t.id, &ENERGY_TAGS, tone.energy_tag()))
        .and_then(|_| add_tag_if_missing(&conn, t.id, &MOOD_TAGS, tone.mood_tag()));
    if let Err(e) = r {
        log::warn!("saving tone failed for id={}: {e}", t.id);
    }
}

fn add_tag_if_missing(conn: &Connection, id: i64, group: &[&str], tag: &str) -> rusqlite::Result<usize> {
    let placeholders = vec!["?"; group.len()].join(", ");
    let sql = format!(
        "UPDATE tracks SET tags = json_insert(tags, '$[#]', ?) WHERE id = ? \
         AND NOT EXISTS (SELECT 1 FROM json_each(tracks.tags) WHERE value IN ({placeholders}))"
    );
    let mut values: Vec<rusqlite::types::Value> = vec![tag.to_string().into(), id.into()];
    values.extend(group.iter().map(|g| g.to_string().into()));
    conn.execute(&sql, params_from_iter(values))
}
