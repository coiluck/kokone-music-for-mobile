// ---------------------------------------------------------------------------
// 3. add : 新規ファイルを LUFS=NULL のまま INSERT
//
// 重複チェックは事前に HashSet にロードしてオンメモリで判定する。
// 旧実装はループ内で `SELECT COUNT(*) WHERE path=?` を毎回叩いていたため
// 数千〜数万曲規模で N+1 になっていた。
// ---------------------------------------------------------------------------

use super::progress::Progress;
use crate::error::Result;
use crate::platform::{self, Candidate, TrackMeta};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

/// 追加したトラック数を返す。
pub fn new_tracks(
    app: &AppHandle,
    conn: &mut Connection,
    candidates: &[Candidate],
    min_duration_ms: Option<i64>,
    progress: &Progress,
) -> Result<u64> {
    // INSERT で衝突しても困らないよう、ループ中に追加された分も HashSet に加えていく。
    let (mut existing_paths, mut existing_hashes) = load_existing_keys(conn)?;
    let mut added = 0u64;
    let tx = conn.transaction()?;

    for (i, c) in candidates.iter().enumerate() {
        progress.adding(i + 1, candidates.len(), &c.path);
        if existing_paths.contains(&c.path) {
            continue;
        }
        // ハッシュより先にメタデータを読み、短すぎる曲はハッシュを計算せずに飛ばす
        let Some(meta) = platform::read_meta(app, c) else { continue };
        if min_duration_ms.is_some_and(|min| meta.duration_ms < min) {
            continue;
        }
        let hash = match platform::hash(app, c) {
            Ok(h) => h,
            Err(e) => {
                log::warn!("hash failed for {}: {e}", c.path);
                continue;
            }
        };
        // 別のパスにある同じ曲 (コピーなど) は追加しない
        if existing_hashes.contains(&hash) {
            continue;
        }

        match insert(&tx, &c.path, &hash, meta) {
            Ok(_) => {
                added += 1;
                existing_paths.insert(c.path.clone());
                existing_hashes.insert(hash);
            }
            Err(e) => log::warn!("insert failed for {}: {e}", c.path),
        }
    }

    tx.commit()?;
    Ok(added)
}

/// アーティストのタグが無い曲の表示。Android の MediaStore が返す値に合わせる。
const UNKNOWN_ARTIST: &str = "<unknown>";

/// LUFS と trailing_silence_ms は NULL のまま登録。バックグラウンドの解析タスクが後から UPDATE する。
fn insert(conn: &Connection, path: &str, hash: &str, meta: TrackMeta) -> rusqlite::Result<usize> {
    let title = meta
        .title
        .or_else(|| std::path::Path::new(path).file_stem().and_then(|s| s.to_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| "Unknown".to_string());
    // artist 列は NOT NULL なので、NULL を入れると INSERT ごと失敗して曲が追加されない
    let artist = meta.artist.unwrap_or_else(|| UNKNOWN_ARTIST.to_string());
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    conn.execute(
        "INSERT INTO tracks \
         (file_hash, path, title, artist, album, tags, duration_ms, lufs, trailing_silence_ms, scanned_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, ?8)",
        params![hash, path, title, artist, meta.album, "[]", meta.duration_ms, now],
    )
}

/// 既存トラックの path と file_hash を HashSet に一括ロードする。
fn load_existing_keys(conn: &Connection) -> Result<(HashSet<String>, HashSet<String>)> {
    let mut stmt = conn.prepare("SELECT path, file_hash FROM tracks")?;
    let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
    let mut paths = HashSet::new();
    let mut hashes = HashSet::new();
    for r in rows {
        let (p, h) = r?;
        paths.insert(p);
        hashes.insert(h);
    }
    Ok((paths, hashes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(title: Option<&str>, artist: Option<&str>) -> TrackMeta {
        TrackMeta { title: title.map(Into::into), artist: artist.map(Into::into), album: None, duration_ms: 1000 }
    }

    fn row(conn: &Connection, path: &str) -> (String, String) {
        conn.query_row("SELECT title, artist FROM tracks WHERE path = ?1", [path], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
    }

    #[test]
    fn inserts_tags() {
        let conn = crate::db::open_in_memory();
        insert(&conn, "/music/a.mp3", "h1", meta(Some("曲"), Some("歌手"))).unwrap();
        assert_eq!(row(&conn, "/music/a.mp3"), ("曲".into(), "歌手".into()));
    }

    #[test]
    fn inserts_track_without_tags() {
        let conn = crate::db::open_in_memory();
        insert(&conn, "/music/無題.mp3", "h1", meta(None, None)).unwrap();
        assert_eq!(row(&conn, "/music/無題.mp3"), ("無題".into(), UNKNOWN_ARTIST.into()));
    }
}
