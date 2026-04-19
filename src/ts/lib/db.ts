import Database from '@tauri-apps/plugin-sql'

export interface Track {
  id: number
  file_hash: string // sha256
  path: string
  title: string | null
  artist: string | null
  album: string | null
  tags: string[]
  duration_ms: number | null
  lufs: number | null
  trailing_silence_ms: number | null
  scanned_at: number
}

export interface playlist {
  id: number
  name: string
  tracks: Track[]
  created_at: number
}

export interface taglist {
  id: number
  name: string
  positive_tags: string[]
  negative_tags: string[]
  created_at: number
}

export interface history {
  track_id: number
  played_at: number
}

let _db: Database | null = null

async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load('sqlite:music.db')
    await initDb(_db)
  }
  return _db
}

async function initDb(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tracks (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      file_hash           TEXT    NOT NULL UNIQUE,
      path                TEXT    NOT NULL UNIQUE,
      title               TEXT,
      artist              TEXT,
      album               TEXT,
      tags                TEXT    NOT NULL DEFAULT '[]',
      duration_ms         INTEGER,
      lufs                REAL,
      trailing_silence_ms INTEGER,
      scanned_at          INTEGER NOT NULL
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS playlists (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      tracks     TEXT    NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS taglists (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      positive_tags TEXT NOT NULL DEFAULT '[]',
      negative_tags TEXT NOT NULL DEFAULT '[]',
      created_at    INTEGER NOT NULL
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS history (
      track_id  INTEGER NOT NULL REFERENCES tracks(id),
      played_at INTEGER NOT NULL
    )
  `)
}

export async function getAllTracks(): Promise<Track[]> {
  const db = await getDb()
  return db.select<Track[]>(
    'SELECT * FROM tracks ORDER BY artist NULLS LAST, album NULLS LAST, title NULLS LAST'
  )
}

export async function searchTracks(query: string): Promise<Track[]> {
  const db = await getDb()
  const q = `%${query}%`
  return db.select<Track[]>(
    `SELECT * FROM tracks
     WHERE title LIKE $1 OR artist LIKE $1 OR album LIKE $1
     ORDER BY artist NULLS LAST, title NULLS LAST`,
    [q]
  )
}