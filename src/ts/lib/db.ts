import Database from '@tauri-apps/plugin-sql'

export interface Track {
  id: number
  path: string
  title: string | null
  artist: string | null
  album: string | null
  duration_ms: number | null
  lufs: number | null
  trailing_silence_ms: number | null
  scanned_at: number
}

let _db: Database | null = null

async function getDb(): Promise<Database> {
  if (!_db) _db = await Database.load('sqlite:music.db')
  return _db
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