import { getDb } from './connection'
import { isString, parseJsonArray } from './json'

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

export interface TrackRow extends Omit<Track, 'tags'> {
  tags: string
}

// dbの行をTrackに変換
export function rowToTrack(row: TrackRow): Track {
  return { ...row, tags: parseJsonArray(row.tags, isString) }
}

// include のタグを全て持ち、exclude のタグを一つも持たないか
export function matchesTags(
  tags: readonly string[],
  include: readonly string[],
  exclude: readonly string[] = [],
): boolean {
  const tagSet = new Set(tags)
  return include.every(tag => tagSet.has(tag)) && !exclude.some(tag => tagSet.has(tag))
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

  // tags 部分はクライアントで AND 絞り込み
  return rows.map(rowToTrack).filter(track => matchesTags(track.tags, tags))
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
