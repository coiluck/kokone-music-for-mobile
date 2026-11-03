import type { PlaylistIcon as PlaylistIconData } from '../playlistIcon'
import { getDb } from './connection'
import { createDefaultIcon, isNumber, parseIconJson, parseJsonArray } from './json'
import { rowToTrack, type Track, type TrackRow } from './tracks'

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
