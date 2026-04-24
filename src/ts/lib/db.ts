import Database from '@tauri-apps/plugin-sql'

export interface Track {
  id: number
  file_hash: string // sha256
  path: string
  title: string
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

// DB 上は tags が TEXT (JSON文字列) で入っているので、
// SELECT の戻り値はそのまま Track にキャストできない
interface TrackRow extends Omit<Track, 'tags'> {
  tags: string
}

let _db: Database | null = null

async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load('sqlite:music.db')
    await initDb()
  }
  return _db
}

export async function initDb(): Promise<void> {
  const db = await getDb()
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tracks (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      file_hash           TEXT    NOT NULL UNIQUE,
      path                TEXT    NOT NULL UNIQUE,
      title               TEXT    NOT NULL,
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

// dbのtagsをstringに変換
function rowToTrack(row: TrackRow): Track {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(row.tags)
    if (Array.isArray(parsed)) {
      tags = parsed.filter((t): t is string => typeof t === 'string')
    }
  } catch {
    // デフォルトの空配列のままだからいい
  }
  return { ...row, tags }
}

export async function getAllTracks(): Promise<Track[]> {
  const db = await getDb()
  const rows = await db.select<TrackRow[]>(
    'SELECT * FROM tracks ORDER BY artist NULLS LAST, album NULLS LAST, title NULLS LAST'
  )
  return rows.map(rowToTrack)
}

export async function searchTracks(query: string): Promise<Track[]> {
  const db = await getDb()
  const q = `%${query}%`
  const rows = await db.select<TrackRow[]>(
    `SELECT * FROM tracks
     WHERE title LIKE $1 OR artist LIKE $1 OR album LIKE $1
     ORDER BY artist NULLS LAST, title NULLS LAST`,
    [q]
  )
  return rows.map(rowToTrack)
}