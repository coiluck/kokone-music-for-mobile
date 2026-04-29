import Database from '@tauri-apps/plugin-sql'

export interface Track {
  id: number
  file_hash: string
  path: string
  title: string
  artist: string
  album: string | null
  tags: string[]
  duration_ms: number | null
  lufs: number | null
  trailing_silence_ms: number | null
  scanned_at: number
}

interface TrackRow extends Omit<Track, 'tags'> {
  tags: string
}

export interface Playlist {
  id: number
  name: string
  trackIds: number[]
  created_at: number
}
interface PlaylistRow extends Omit<Playlist, 'trackIds'> {
  tracks: string
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
      tracks     INTEGER NOT NULL DEFAULT '[]',
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

// 配列にする
function parseJsonArray<T>(json: string, guard: (v: unknown) => v is T): T[] {
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) return parsed.filter(guard)
  } catch { /* noop */ }
  return []
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number'


// dbのtagsをstringに変換
function rowToTrack(row: TrackRow): Track {
  return { ...row, tags: parseJsonArray(row.tags, isString) }
}

export async function getAllTracks(): Promise<Track[]> {
  const db = await getDb()
  const rows = await db.select<TrackRow[]>(
    'SELECT * FROM tracks ORDER BY artist, album NULLS LAST, title'
  )
  return rows.map(rowToTrack)
}

export async function searchTracks(query: string): Promise<Track[]> {
  const db = await getDb()
  const q = `%${query}%`
  const rows = await db.select<TrackRow[]>(
    `SELECT * FROM tracks
     WHERE title LIKE $1 OR artist LIKE $1 OR album LIKE $1
     ORDER BY artist, title`,
    [q]
  )
  return rows.map(rowToTrack)
}


function rowToPlaylist(row: PlaylistRow): Playlist {
  return { ...row, trackIds: parseJsonArray(row.tracks, isNumber) }
}

export async function getPlaylists(): Promise<Playlist[]> {
  const db = await getDb()
  const rows = await db.select<PlaylistRow[]>(
    'SELECT * FROM playlists ORDER BY created_at DESC'
  )
  return rows.map(rowToPlaylist)
}

export async function getPlaylistTracks(trackIds: number[]): Promise<Track[]> {
  if (trackIds.length === 0) return []
  const db = await getDb()
  const placeholders = trackIds.map((_, i) => `$${i + 1}`).join(', ')
  const rows = await db.select<TrackRow[]>(
    `SELECT * FROM tracks WHERE id IN (${placeholders})`,
    trackIds
  )
  const map = new Map(rows.map(r => [r.id, rowToTrack(r)]))
  return trackIds.flatMap(id => map.has(id) ? [map.get(id)!] : [])
}

export async function getHistory() {
  // historyから直近100件
  const db = await getDb()
  const rows = await db.select<TrackRow[]>(`
    SELECT t.* FROM tracks t
    INNER JOIN (
      SELECT track_id, MAX(played_at) as played_at
      FROM history
      GROUP BY track_id
      ORDER BY played_at DESC
      LIMIT 100
    ) h ON h.track_id = t.id
    ORDER BY h.played_at DESC
  `)
  return rows.map(rowToTrack)
}

// ここからおすすめ用

// 再生回数の集計（曲ごと）
export async function getPlayCounts(limit = 200): Promise<Map<number, number>> {
  const db = await getDb()
  const rows = await db.select<{ track_id: number; cnt: number }[]>(
    `SELECT track_id, COUNT(*) as cnt
     FROM (
       SELECT track_id FROM history ORDER BY played_at DESC LIMIT $1
     )
     GROUP BY track_id`,
    [limit]
  )
  return new Map(rows.map(r => [r.track_id, r.cnt]))
}

// タグの出現回数（履歴上のタグ集計）
export async function getHistoryTagCounts(limit = 500): Promise<Map<string, number>> {
  const db = await getDb()
  const rows = await db.select<{ tags: string; cnt: number }[]>(
    `SELECT t.tags, COUNT(*) as cnt
     FROM (
       SELECT track_id FROM history ORDER BY played_at DESC LIMIT $1
     ) h
     INNER JOIN tracks t ON t.id = h.track_id
     GROUP BY t.id`,
    [limit]
  )
  const tagCount = new Map<string, number>()
  for (const { tags, cnt } of rows) {
    try {
      const parsed = JSON.parse(tags)
      if (!Array.isArray(parsed)) continue
      for (const tag of parsed) {
        if (typeof tag !== 'string') continue
        tagCount.set(tag, (tagCount.get(tag) ?? 0) + cnt)
      }
    } catch { /* noop */ }
  }
  return tagCount
}

// アーティストの出現回数
export async function getHistoryArtistCounts(limit = 200): Promise<Map<string, number>> {
  const db = await getDb()
  const rows = await db.select<{ artist: string; cnt: number }[]>(
    `SELECT t.artist, COUNT(*) as cnt
     FROM (
       SELECT track_id FROM history ORDER BY played_at DESC LIMIT $1
     ) h
     INNER JOIN tracks t ON t.id = h.track_id
     GROUP BY t.artist`,
    [limit]
  )
  return new Map(rows.map(r => [r.artist ?? '', r.cnt]))
}

// 直近200件の履歴での順位（同じtrackは最新の順位を採用）
export async function getRecentTrackRanks(limit = 200): Promise<Map<number, number>> {
  const db = await getDb()
  const rows = await db.select<{ track_id: number }[]>(
    `SELECT track_id FROM history ORDER BY played_at DESC LIMIT $1`,
    [limit]
  )
  const map = new Map<number, number>()
  rows.forEach(({ track_id }, index) => {
    if (!map.has(track_id)) map.set(track_id, index)
  })
  return map
}

import { generateRecommend } from './recommend'

export async function getRecommended(): Promise<Track[]> {
  const [allTracks, playCounts, historyTagCounts, historyArtistCounts, recentRanks] =
    await Promise.all([
      getAllTracks(),
      getPlayCounts(200),
      getHistoryTagCounts(500),
      getHistoryArtistCounts(200),
      getRecentTrackRanks(200),
    ])

  return generateRecommend({
    allTracks,
    playCounts,
    historyTagCounts,
    historyArtistCounts,
    recentRanks,
  })
}

export async function musicPlay(trackId: number): Promise<void> {
  const db = await getDb()
  const nowUNIX = Date.now()
  await db.execute(
    'INSERT INTO history (track_id, played_at) VALUES ($1, $2)',
    [trackId, nowUNIX]
  )
}