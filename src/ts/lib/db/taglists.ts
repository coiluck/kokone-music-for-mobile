import type { PlaylistIcon as PlaylistIconData } from '../playlistIcon'
import { getDb } from './connection'
import { createDefaultIcon, isString, parseIconJson, parseJsonArray } from './json'
import { matchesTags, rowToTrack, type Track, type TrackRow } from './tracks'

export interface Taglist {
  id: number
  name: string
  positive_tags: string[]
  negative_tags: string[]
  icon: PlaylistIconData
  created_at: number
}
interface TaglistRow extends Omit<Taglist, 'positive_tags' | 'negative_tags' | 'icon'> {
  positive_tags: string
  negative_tags: string
  icon: string | null
}

function rowToTaglist(row: TaglistRow): Taglist {
  return {
    ...row,
    positive_tags: parseJsonArray(row.positive_tags, isString),
    negative_tags: parseJsonArray(row.negative_tags, isString),
    icon: parseIconJson(row.icon),
  }
}

export async function getTaglists(): Promise<Taglist[]> {
  const db = await getDb()
  const rows = await db.select<TaglistRow[]>(
    'SELECT * FROM taglists ORDER BY created_at DESC'
  )
  return rows.map(rowToTaglist)
}

// taglistを追加
export async function addTaglist(name: string): Promise<Taglist> {
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

export async function deleteTaglist(id: number): Promise<void> {
  const db = await getDb()
  await db.execute('DELETE FROM taglists WHERE id = $1', [id])
}

export async function renameTaglist(id: number, name: string): Promise<void> {
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

// positive_tagsを全て含み、negative_tagsを一つも含まない曲
export async function getTaglistTracks(pos_tags: string[], neg_tags: string[]): Promise<Track[]> {
  if (pos_tags.length === 0) return []
  const db = await getDb()
  const rows = await db.select<TrackRow[]>(
    'SELECT * FROM tracks ORDER BY artist, album NULLS LAST, title'
  )
  return rows.map(rowToTrack).filter(track => matchesTags(track.tags, pos_tags, neg_tags))
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
