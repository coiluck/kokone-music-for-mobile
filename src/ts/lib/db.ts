import Database from '@tauri-apps/plugin-sql'
import type { PlaylistIcon as PlaylistIconData } from './playlistIcon'
import { generateRecommend } from './recommend'

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
      played_at INTEGER NOT NULL,
      listened_ms INTEGER NOT NULL DEFAULT 0
    )
  `)
  // 既存インストールの history には listened_ms 列が無い。CREATE ... IF NOT EXISTS は
  // 既存テーブルに列を足さないので、無ければ ALTER で追加する (冪等)。
  const historyCols = await db.select<{ name: string }[]>('PRAGMA table_info(history)')
  if (!historyCols.some(c => c.name === 'listened_ms')) {
    await db.execute('ALTER TABLE history ADD COLUMN listened_ms INTEGER NOT NULL DEFAULT 0')
  }
  // 曲調推定 (src-tauri/src/scan/tone_tagging.rs) のスコア。NULL は未解析。
  const trackCols = await db.select<{ name: string }[]>('PRAGMA table_info(tracks)')
  for (const col of ['energy_score', 'mood_score']) {
    if (!trackCols.some(c => c.name === col)) {
      await db.execute(`ALTER TABLE tracks ADD COLUMN ${col} REAL`)
    }
  }
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

// ランダムなhue (0-359)のidenticonアイコンを生成
function createDefaultIcon(): PlaylistIconData {
  const hue = Math.floor(Math.random() * 360)
  return { kind: 'auto', hue }
}

// iconカラム (JSON文字列 or null) をPlaylistIconDataに復元する
function parseIconJson(json: string | null): PlaylistIconData {
  if (!json) return createDefaultIcon()
  try { return JSON.parse(json) as PlaylistIconData }
  catch { return createDefaultIcon() }
}

// dbの行をTrackに変換
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

export async function searchTracks(query: string, tags: string[] = []): Promise<Track[]> {
  const db = await getDb()
  const trimmed = query.trim()

  // query 部分は SQL で絞る
  let rows: TrackRow[]
  if (trimmed) {
    const q = `%${trimmed}%`
    rows = await db.select<TrackRow[]>(
      `SELECT * FROM tracks
       WHERE title LIKE $1 OR artist LIKE $1 OR album LIKE $1
       ORDER BY artist, title`,
      [q]
    )
  } else {
    rows = await db.select<TrackRow[]>(
      'SELECT * FROM tracks ORDER BY artist, title'
    )
  }

  const tracks = rows.map(rowToTrack)

  // tags 部分はクライアントで AND 絞り込み
  if (tags.length === 0) return tracks
  const tagSet = new Set(tags)
  return tracks.filter(track => {
    const trackTagSet = new Set(track.tags)
    for (const tag of tagSet) {
      if (!trackTagSet.has(tag)) return false
    }
    return true
  })
}

export async function updateTrack(
  id: number,
  data: { title: string; artist: string; tags: string[]; path?: string }
): Promise<void> {
  const db = await getDb()
  if (data.path !== undefined) {
    // Android でタイトル変更に伴いファイル名が変わったとき、path も追従させる。
    await db.execute(
      'UPDATE tracks SET title = $1, artist = $2, tags = $3, path = $4 WHERE id = $5',
      [data.title, data.artist, JSON.stringify(data.tags), data.path, id]
    )
  } else {
    await db.execute(
      'UPDATE tracks SET title = $1, artist = $2, tags = $3 WHERE id = $4',
      [data.title, data.artist, JSON.stringify(data.tags), id]
    )
  }
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

export interface ListeningClock {
  streams: number[] // 長さ24、0時台〜23時台の再生回数
  minutes: number[] // 長さ24、0時台〜23時台の再生時間（分）
}

// 直近 weeks 週間の時間帯別リスニング傾向
export async function getListeningClock(weeks = 4): Promise<ListeningClock> {
  const db = await getDb()
  const since = Date.now() - weeks * 7 * 24 * 60 * 60 * 1000
  const rows = await db.select<{ played_at: number; listened_ms: number }[]>(
    'SELECT played_at, listened_ms FROM history WHERE played_at >= $1',
    [since]
  )
  const streams = new Array<number>(24).fill(0)
  const minutes = new Array<number>(24).fill(0)
  for (const r of rows) {
    const hour = new Date(r.played_at).getHours()
    streams[hour] += 1
    minutes[hour] += r.listened_ms / 60000
  }
  return { streams, minutes }
}

// 全期間の総再生時間 (ms)
export async function getTotalListeningMs(): Promise<number> {
  const db = await getDb()
  const rows = await db.select<{ total: number | null }[]>(
    'SELECT SUM(listened_ms) AS total FROM history'
  )
  return rows[0]?.total ?? 0
}

export interface ListeningDay {
  date: number    // その日のローカル0時のタイムスタンプ
  streams: number // その日の再生回数
}

export async function getListeningHeatmap(weeks = 4): Promise<ListeningDay[]> {
  const db = await getDb()
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - start.getDay() - (weeks - 1) * 7)

  const rows = await db.select<{ played_at: number }[]>(
    'SELECT played_at FROM history WHERE played_at >= $1',
    [start.getTime()]
  )

  const days: ListeningDay[] = []
  const cursor = new Date(start)
  for (let i = 0; i < weeks * 7; i++) {
    days.push({ date: cursor.getTime(), streams: 0 })
    cursor.setDate(cursor.getDate() + 1)
  }

  const indexByDate = new Map(days.map((d, i) => [d.date, i]))
  for (const { played_at } of rows) {
    const day = new Date(played_at)
    day.setHours(0, 0, 0, 0)
    const index = indexByDate.get(day.getTime())
    if (index !== undefined) days[index].streams += 1
  }
  return days
}

// ここからおすすめ用

// 再生回数の集計（曲ごと）
async function getPlayCounts(limit = 100): Promise<Map<number, number>> {
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
async function getHistoryTagCounts(limit = 500): Promise<Map<string, number>> {
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
async function getHistoryArtistCounts(limit = 200): Promise<Map<string, number>> {
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
async function getRecentTrackRanks(limit = 200): Promise<Map<number, number>> {
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

// 再生開始時に history 行を作り、その rowid を返す。listened_ms は 0 で始め、
// 実際に聴いた時間が確定するたび updateListenedMs で更新する。
export async function startPlay(trackId: number): Promise<number> {
  const db = await getDb()
  const nowUNIX = Date.now()
  const result = await db.execute(
    'INSERT INTO history (track_id, played_at, listened_ms) VALUES ($1, $2, 0)',
    [trackId, nowUNIX]
  )
  return result.lastInsertId as number
}

// 再生セッションの累積リスニング時間 (ms) を history 行に反映する。
// 再生中は定期的に、曲の切替・停止時には確定値で呼ばれる。途中で kill されても
// 直近の値までは残る。
export async function updateListenedMs(historyId: number, listenedMs: number): Promise<void> {
  const db = await getDb()
  await db.execute(
    'UPDATE history SET listened_ms = $1 WHERE rowid = $2',
    [Math.round(listenedMs), historyId]
  )
}

// ここからプレイリスト用

function rowToPlaylist(row: PlaylistRow): Playlist {
  return {
    ...row,
    trackIds: parseJsonArray(row.tracks, isNumber),
    icon: parseIconJson(row.icon),
  }
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

// ここからtag用
function rowToTaglist(row: TaglistRow): taglist {
  return {
    ...row,
    positive_tags: parseJsonArray(row.positive_tags, isString),
    negative_tags: parseJsonArray(row.negative_tags, isString),
    icon: parseIconJson(row.icon),
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
  if (pos_tags.length === 0) return []
  const db = await getDb()
  const rows = await db.select<TrackRow[]>(
    'SELECT * FROM tracks ORDER BY artist, album NULLS LAST, title'
  )
  const posSet = new Set(pos_tags)
  const negSet = new Set(neg_tags)

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


// ここからalbum用
// album一覧を取得（album名と曲数）
export async function getAlbums(): Promise<{ album: string; count: number }[]> {
  const db = await getDb()
  const rows = await db.select<{ album: string | null; cnt: number }[]>(
    `SELECT album, COUNT(*) as cnt
     FROM tracks
     WHERE album IS NOT NULL AND album != ''
     GROUP BY album
     ORDER BY album`
  )
  return rows.map(r => ({ album: r.album ?? '', count: r.cnt }))
}

// 特定のalbumに含まれるTrack[]を取得
export async function getAlbumTracks(album: string): Promise<Track[]> {
  const db = await getDb()
  const rows = await db.select<TrackRow[]>(
    `SELECT * FROM tracks WHERE album = $1 ORDER BY artist, title`,
    [album]
  )
  return rows.map(rowToTrack)
}
