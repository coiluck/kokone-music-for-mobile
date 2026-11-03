//! music.db への接続。テーブルはフロント (src/ts/lib/db/connection.ts) が作る。

use crate::error::Result;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn path(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join("music.db"))
}

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA temp_store = MEMORY;
         PRAGMA cache_size = -64000;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(conn)
}

/// テスト用に、db/connection.ts と同じテーブルを持つメモリ上の DB を作る。
#[cfg(test)]
pub fn open_in_memory() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE tracks (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            file_hash           TEXT    NOT NULL UNIQUE,
            path                TEXT    NOT NULL UNIQUE,
            title               TEXT    NOT NULL,
            artist              TEXT    NOT NULL DEFAULT 'Unknown',
            album               TEXT,
            tags                TEXT    NOT NULL DEFAULT '[]',
            duration_ms         INTEGER,
            lufs                REAL,
            trailing_silence_ms INTEGER,
            scanned_at          INTEGER NOT NULL,
            energy_score        REAL,
            mood_score          REAL
         );
         CREATE TABLE playlists (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            tracks     TEXT    NOT NULL DEFAULT '[]',
            icon       TEXT,
            created_at INTEGER NOT NULL
         );
         CREATE TABLE history (
            track_id    INTEGER NOT NULL REFERENCES tracks(id),
            played_at   INTEGER NOT NULL,
            listened_ms INTEGER NOT NULL DEFAULT 0
         );
         PRAGMA foreign_keys = ON;",
    )
    .unwrap();
    conn
}
