import Database from '@tauri-apps/plugin-sql'

// 接続とスキーマ作成は1回だけ行い、同時に呼ばれても同じ Promise を返す
let dbPromise: Promise<Database> | null = null

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = open().catch(e => {
      dbPromise = null
      throw e
    })
  }
  return dbPromise
}

// 起動時に呼ぶ
export async function initDb(): Promise<void> {
  await getDb()
}

async function open(): Promise<Database> {
  const db = await Database.load('sqlite:music.db')
  await migrate(db)
  return db
}

async function migrate(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tracks (
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
      scanned_at          INTEGER NOT NULL
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS playlists (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      tracks     TEXT    NOT NULL DEFAULT '[]',
      icon       TEXT,
      created_at INTEGER NOT NULL
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS taglists (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      positive_tags TEXT NOT NULL DEFAULT '[]',
      negative_tags TEXT NOT NULL DEFAULT '[]',
      icon          TEXT,
      created_at    INTEGER NOT NULL
    )
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS history (
      track_id  INTEGER NOT NULL REFERENCES tracks(id),
      played_at INTEGER NOT NULL,
      listened_ms INTEGER NOT NULL DEFAULT 0
    )
  `)
  // 既存インストールの history には listened_ms 列が無い
  const historyCols = await db.select<{ name: string }[]>('PRAGMA table_info(history)')
  if (!historyCols.some(c => c.name === 'listened_ms')) {
    await db.execute('ALTER TABLE history ADD COLUMN listened_ms INTEGER NOT NULL DEFAULT 0')
  }
  // 曲調推定のスコア
  const trackCols = await db.select<{ name: string }[]>('PRAGMA table_info(tracks)')
  for (const col of ['energy_score', 'mood_score']) {
    if (!trackCols.some(c => c.name === col)) {
      await db.execute(`ALTER TABLE tracks ADD COLUMN ${col} REAL`)
    }
  }
}
