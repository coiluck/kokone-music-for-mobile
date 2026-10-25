// ---------------------------------------------------------------------------
// 5. 曲調タグ : LUFS 解析の後に、energy_score が NULL のトラックの曲調を推定する。
//
// スコアは tracks.energy_score / mood_score に保存し、曲調タグ (ENERGY_TAGS / MOOD_TAGS) が
// まだ 1 つも付いていない曲にだけ推定タグを追加する。ユーザーが付けたタグは上書きしない。
// 解析が重い (1 曲数秒) ので、途中で終了しても結果が残るよう 1 曲ごとに書き込む。
// ---------------------------------------------------------------------------

use crate::analysis::tone::{self, Tone, ENERGY_TAGS, MOOD_TAGS};
use crate::db;
use crate::error::{catch_panic, Result};
use crate::platform::{self, AudioFiles};
use rusqlite::{params, params_from_iter, Connection};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

struct Pending {
    id: i64,
    path: String,
    lufs: Option<f64>,
}

pub fn run(app: &AppHandle, db_path: &Path) -> Result<()> {
    let conn = db::open(db_path)?;
    let pending: Vec<Pending> = conn
        .prepare("SELECT id, path, lufs FROM tracks WHERE energy_score IS NULL")?
        .query_map([], |row| Ok(Pending { id: row.get(0)?, path: row.get(1)?, lufs: row.get(2)? }))?
        .filter_map(|r| r.ok())
        .collect();
    if pending.is_empty() {
        return Ok(());
    }

    let files = AudioFiles::resolve(app, &pending.iter().map(|t| t.path.as_str()).collect::<Vec<_>>())?;
    let conn = Mutex::new(conn);
    // 1 曲あたり 100MB 程度使うので、LUFS 解析より並列度を抑える
    let threads = (num_cpus::get() / 2).clamp(1, 4);
    platform::for_each(&pending, threads, |t| {
        match catch_panic(|| tone::analyze(files.open(&t.path)?, &platform::extension(&t.path), t.lufs)) {
            Ok(tone) => {
                if let Err(e) = save(&conn.lock().unwrap(), t.id, &tone) {
                    log::warn!("saving tone failed for id={}: {e}", t.id);
                }
            }
            Err(e) => log::warn!("tone analysis failed for {}: {e}", t.path),
        }
    })?;
    let _ = app.emit("tone-analyze-completed", ());
    Ok(())
}

/// スコアを保存し、曲調タグが未設定ならタグを追加する。
fn save(conn: &Connection, id: i64, tone: &Tone) -> rusqlite::Result<()> {
    conn.execute("UPDATE tracks SET energy_score = ?1, mood_score = ?2 WHERE id = ?3", params![tone.energy_score, tone.mood_score, id])?;
    add_tag_if_missing(conn, id, &ENERGY_TAGS, tone.energy_tag())?;
    add_tag_if_missing(conn, id, &MOOD_TAGS, tone.mood_tag())?;
    Ok(())
}

/// `group` のタグが 1 つも付いていなければ `tag` を追加する。
/// 判定と追加を 1 つの UPDATE で行い、読み込みから書き込みの間にフロントで編集されたタグを消さないようにする。
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

#[cfg(test)]
mod tests {
    use super::*;

    fn track_with_tags(conn: &Connection, tags: &str) -> i64 {
        conn.execute(
            "INSERT INTO tracks (file_hash, path, title, tags, scanned_at) VALUES (?1, ?1, 't', ?1, 0)",
            params![tags],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn tags_of(conn: &Connection, id: i64) -> String {
        conn.query_row("SELECT tags FROM tracks WHERE id = ?1", [id], |r| r.get(0)).unwrap()
    }

    #[test]
    fn adds_tag_when_group_is_missing() {
        let conn = db::open_in_memory();
        let id = track_with_tags(&conn, r#"["好き"]"#);

        assert_eq!(add_tag_if_missing(&conn, id, &MOOD_TAGS, "明").unwrap(), 1);
        assert_eq!(tags_of(&conn, id), r#"["好き","明"]"#);
    }

    #[test]
    fn keeps_tag_the_user_chose() {
        let conn = db::open_in_memory();
        let id = track_with_tags(&conn, r#"["暗"]"#);

        assert_eq!(add_tag_if_missing(&conn, id, &MOOD_TAGS, "明").unwrap(), 0);
        assert_eq!(tags_of(&conn, id), r#"["暗"]"#);
    }

    #[test]
    fn groups_are_independent() {
        let conn = db::open_in_memory();
        let id = track_with_tags(&conn, "[]");

        save(&conn, id, &Tone { energy_score: 2.0, mood_score: 0.0 }).unwrap();
        save(&conn, id, &Tone { energy_score: 0.0, mood_score: 1.0 }).unwrap();

        // 2 回目は両方のグループにタグがあるので何も足さない
        assert_eq!(tags_of(&conn, id), format!(r#"["{}","{}"]"#, ENERGY_TAGS[2], MOOD_TAGS[1]));
        let (e, m): (f64, f64) = conn.query_row("SELECT energy_score, mood_score FROM tracks WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((e, m), (0.0, 1.0));
    }
}
