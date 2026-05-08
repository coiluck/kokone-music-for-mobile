import Database from '@tauri-apps/plugin-sql'
import type { PlaylistIcon as PlaylistIconData } from './playlistIcon'

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
  icon: PlaylistIconData
  created_at: number
}
interface PlaylistRow extends Omit<Playlist, 'trackIds' | 'icon'> {
  icon: string
  tracks: string
}

export interface taglist {
  id: number
  name: string
  positive_tags: string[]
  negative_tags: string[]
  icon: PlaylistIconData
  created_at: number
}
interface TaglistRow extends Omit<taglist, 'positive_tags' | 'negative_tags' | 'icon'> {
  positive_tags: string
  negative_tags: string
  icon: string | null
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

export async function updateTrack(
  id: number,
  data: { title: string; artist: string; tags: string[] }
): Promise<void> {
  const db = await getDb()
  await db.execute(
    'UPDATE tracks SET title = $1, artist = $2, tags = $3 WHERE id = $4',
    [data.title, data.artist, JSON.stringify(data.tags), id]
  )
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

// ここからプレイリスト用

// ランダムなhue (0-359)のidenticonアイコンを生成
function createDefaultIcon(): PlaylistIconData {
  const hue = Math.floor(Math.random() * 360)
  return { kind: 'auto', hue }
}

function rowToPlaylist(row: PlaylistRow): Playlist {
  let icon: PlaylistIconData = createDefaultIcon()
  if (row.icon) {
    try { icon = JSON.parse(row.icon) as PlaylistIconData }
    catch { icon = createDefaultIcon() }
  }
  return { ...row, trackIds: parseJsonArray(row.tracks, isNumber), icon }
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

// playlistを追加
export async function addPlaylist(name: string): Promise<Playlist> {
  const db = await getDb()
  const created_at = Date.now()

  // githubみたいなやつを生成
  const icon = createDefaultIcon()

  const result = await db.execute(
    'INSERT INTO playlists (name, tracks, icon, created_at) VALUES ($1, $2, $3, $4)',
    [name, '[]', JSON.stringify(icon), created_at]
  )

  return {
    id: result.lastInsertId as number,
    name,
    trackIds: [],
    icon,
    created_at,
  }
}

export async function deletePlaylist(id: number): Promise<void> {
  const db = await getDb()
  await db.execute('DELETE FROM playlists WHERE id = $1', [id])
}

export async function renamePlaylist(id: number, name: string): Promise<void> {
  const db = await getDb()
  await db.execute('UPDATE playlists SET name = $1 WHERE id = $2', [name, id])
}

// 内部ヘルパー: 現在のtrackIdsを取得
async function getPlaylistTrackIds(id: number): Promise<number[]> {
  const db = await getDb()
  const rows = await db.select<{ tracks: string }[]>(
    'SELECT tracks FROM playlists WHERE id = $1',
    [id]
  )
  if (rows.length === 0) return []
  return parseJsonArray(rows[0].tracks, isNumber)
}

// playlistにtrackを追加
export async function addTrackToPlaylist(playlistId: number, trackId: number): Promise<void> {
  const db = await getDb()
  const current = await getPlaylistTrackIds(playlistId)
  if (current.includes(trackId)) return
  const next = [...current, trackId]
  await db.execute(
    'UPDATE playlists SET tracks = $1 WHERE id = $2',
    [JSON.stringify(next), playlistId]
  )
}

// playlistからtrackを削除
export async function removeTrackFromPlaylist(playlistId: number, trackId: number): Promise<void> {
  const db = await getDb()
  const current = await getPlaylistTrackIds(playlistId)
  const next = current.filter(id => id !== trackId)
  if (next.length === current.length) return
  await db.execute(
    'UPDATE playlists SET tracks = $1 WHERE id = $2',
    [JSON.stringify(next), playlistId]
  )
}

// アイコンを設定（kind/name/hueを丸ごと差し替え）
export async function setPlaylistIcon(
  id: number,
  icon: PlaylistIconData
): Promise<void> {
  const db = await getDb()
  await db.execute(
    'UPDATE playlists SET icon = $1 WHERE id = $2',
    [JSON.stringify(icon), id]
  )
}

// hueだけ差し替え（サイコロボタン用）
export async function setPlaylistIconHue(id: number, hue: number): Promise<void> {
  const db = await getDb()
  const rows = await db.select<{ icon: string | null }[]>(
    'SELECT icon FROM playlists WHERE id = $1',
    [id]
  )
  if (rows.length === 0 || !rows[0].icon) return
  try {
    const icon = JSON.parse(rows[0].icon) as PlaylistIconData
    icon.hue = hue
    await db.execute(
      'UPDATE playlists SET icon = $1 WHERE id = $2',
      [JSON.stringify(icon), id]
    )
  } catch { /* noop */ }
}

// ここからtag用
function rowToTaglist(row: TaglistRow): taglist {
  let icon: PlaylistIconData = createDefaultIcon()
  if (row.icon) {
    try { icon = JSON.parse(row.icon) as PlaylistIconData }
    catch { icon = createDefaultIcon() }
  }
  return {
    ...row,
    positive_tags: parseJsonArray(row.positive_tags, isString),
    negative_tags: parseJsonArray(row.negative_tags, isString),
    icon,
  }
}

export async function getTagslists(): Promise<taglist[]> {
  const db = await getDb()
  const rows = await db.select<TaglistRow[]>(
    'SELECT * FROM taglists ORDER BY created_at DESC'
  )
  return rows.map(rowToTaglist)
}

// taglistを追加
export async function addTagslists(name: string): Promise<taglist> {
  const db = await getDb()
  const created_at = Date.now()

  // githubみたいなやつを生成
  const icon = createDefaultIcon()

  const result = await db.execute(
    'INSERT INTO taglists (name, positive_tags, negative_tags, icon, created_at) VALUES ($1, $2, $3, $4, $5)',
    [name, '[]', '[]', JSON.stringify(icon), created_at]
  )

  return {
    id: result.lastInsertId as number,
    name,
    positive_tags: [],
    negative_tags: [],
    icon,
    created_at,
  }
}

export async function deleteTagsLists(id: number): Promise<void>  {
  const db = await getDb()
  await db.execute('DELETE FROM taglists WHERE id = $1', [id])
}

export async function renameTagsLists(id: number, name: string): Promise<void> {
  const db = await getDb()
  await db.execute('UPDATE taglists SET name = $1 WHERE id = $2', [name, id])
}

// taglistのアイコンを設定
export async function setTaglistIcon(
  id: number,
  icon: PlaylistIconData
): Promise<void> {
  const db = await getDb()
  await db.execute(
    'UPDATE taglists SET icon = $1 WHERE id = $2',
    [JSON.stringify(icon), id]
  )
}

export async function getTagListTracks(pos_tags: string[], neg_tags: string[]): Promise<Track[]> {
  const db = await getDb()
  const rows = await db.select<TrackRow[]>(
    'SELECT * FROM tracks ORDER BY artist, album NULLS LAST, title'
  )
  const posSet = new Set(pos_tags)
  const negSet = new Set(neg_tags)

  if (pos_tags.length === 0) return []

  return rows
    .map(rowToTrack)
    .filter(track => {
      const tagSet = new Set(track.tags)
      // negative_tagsを一つでも含むなら除外
      for (const neg of negSet) {
        if (tagSet.has(neg)) return false
      }
      // positive_tagsを全て含む必要がある
      for (const pos of posSet) {
        if (!tagSet.has(pos)) return false
      }
      return true
    })
}

// taglistのpositive_tagsを更新
export async function setTaglistPositiveTags(
  id: number,
  tags: string[]
): Promise<void> {
  const db = await getDb()
  await db.execute(
    'UPDATE taglists SET positive_tags = $1 WHERE id = $2',
    [JSON.stringify(tags), id]
  )
}

// taglistのnegative_tagsを更新
export async function setTaglistNegativeTags(
  id: number,
  tags: string[]
): Promise<void> {
  const db = await getDb()
  await db.execute(
    'UPDATE taglists SET negative_tags = $1 WHERE id = $2',
    [JSON.stringify(tags), id]
  )
}

// 使わない。マイグレーション用
export async function resetDb(): Promise<void> {
  const db = await getDb()
  await db.execute('DROP TABLE IF EXISTS history')
  await db.execute('DROP TABLE IF EXISTS playlists')
  await db.execute('DROP TABLE IF EXISTS taglists')
  await db.execute('DROP TABLE IF EXISTS tracks')
  await initDb()
}