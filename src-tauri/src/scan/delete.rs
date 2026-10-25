// ---------------------------------------------------------------------------
// 2. detect delete : 設定に適合しないトラックを DB から削除
//
//   - スキャン対象フォルダ外のパスになったトラック
//     （フォルダがリストから外された、またはファイル自体が移動/削除された）
//   - 最短の長さ (ignoreMode / ignoreTime) より短いトラック
// ---------------------------------------------------------------------------

use crate::error::Result;
use rusqlite::{params, params_from_iter, Connection};

/// 消したトラック数を返す。`exists` はファイルがまだあるか (platform::existence)。
pub fn unmatched_tracks(
    conn: &mut Connection,
    scan_folders: &[String],
    min_duration_ms: Option<i64>,
    exists: impl Fn(&str) -> bool,
) -> Result<u64> {
    // 削除対象 id の収集はトランザクションの外でやる
    // (prepare 中の stmt の生存期間と tx の借用が衝突するのを避けるため)
    let to_delete: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT id, path, duration_ms FROM tracks")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<i64>>(2)?))
        })?;
        let mut v = Vec::new();
        for row in rows {
            let (id, path, duration_ms) = row?;
            let in_scan_folder = scan_folders.iter().any(|f| path.starts_with(f));
            let too_short = matches!((min_duration_ms, duration_ms), (Some(min), Some(d)) if d < min);
            if !in_scan_folder || !exists(&path) || too_short {
                v.push(id);
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
        tx.execute(&format!("DELETE FROM history WHERE track_id IN ({placeholders})"), params_from_iter(chunk))?;
        deleted += tx.execute(&format!("DELETE FROM tracks WHERE id IN ({placeholders})"), params_from_iter(chunk))? as u64;
    }

    // playlists.tracks (JSON 配列) からも削除対象 id を除去する。
    //
    // 削除対象を temp テーブルに入れて、JSON1 の json_each で配列を展開し、
    // NOT IN で残すものだけ json_group_array で再構築する。
    // 空配列で json_group_array が NULL になるケースは COALESCE で '[]' にフォールバック。
    tx.execute("CREATE TEMP TABLE IF NOT EXISTS _deleted_track_ids (id INTEGER PRIMARY KEY)", [])?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn insert_track(conn: &Connection, path: &str, duration_ms: i64) -> i64 {
        conn.execute(
            "INSERT INTO tracks (file_hash, path, title, duration_ms, scanned_at) VALUES (?1, ?1, 't', ?2, 0)",
            params![path, duration_ms],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn remaining_paths(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("SELECT path FROM tracks ORDER BY id").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    }

    #[test]
    fn deletes_tracks_outside_folders_missing_or_too_short() {
        let mut conn = crate::db::open_in_memory();
        insert_track(&conn, "/music/keep.mp3", 200_000);
        insert_track(&conn, "/other/outside.mp3", 200_000);
        insert_track(&conn, "/music/missing.mp3", 200_000);
        insert_track(&conn, "/music/short.mp3", 5_000);

        let deleted = unmatched_tracks(&mut conn, &["/music".into()], Some(20_000), |p| p != "/music/missing.mp3").unwrap();

        assert_eq!(deleted, 3);
        assert_eq!(remaining_paths(&conn), ["/music/keep.mp3"]);
    }

    #[test]
    fn keeps_short_tracks_without_min_duration() {
        let mut conn = crate::db::open_in_memory();
        insert_track(&conn, "/music/short.mp3", 5_000);

        assert_eq!(unmatched_tracks(&mut conn, &["/music".into()], None, |_| true).unwrap(), 0);
        assert_eq!(remaining_paths(&conn), ["/music/short.mp3"]);
    }

    #[test]
    fn removes_deleted_tracks_from_history_and_playlists() {
        let mut conn = crate::db::open_in_memory();
        let keep = insert_track(&conn, "/music/keep.mp3", 200_000);
        let gone = insert_track(&conn, "/music/gone.mp3", 200_000);
        conn.execute("INSERT INTO history (track_id, played_at) VALUES (?1, 1), (?2, 2)", params![keep, gone]).unwrap();
        conn.execute(
            "INSERT INTO playlists (name, tracks, created_at) VALUES ('both', ?1, 0), ('only_gone', ?2, 0), ('only_keep', ?3, 0)",
            params![format!("[{keep},{gone}]"), format!("[{gone}]"), format!("[{keep}]")],
        )
        .unwrap();

        unmatched_tracks(&mut conn, &["/music".into()], None, |p| p != "/music/gone.mp3").unwrap();

        let history: Vec<i64> =
            conn.prepare("SELECT track_id FROM history").unwrap().query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(history, [keep]);
        let playlists: Vec<String> = conn
            .prepare("SELECT tracks FROM playlists ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(playlists, [format!("[{keep}]"), "[]".to_string(), format!("[{keep}]")]);
    }
}
