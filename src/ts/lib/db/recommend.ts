// おすすめ用の履歴集計
import { generateRecommend, RECENT_LIMIT } from '../recommend'
import { getDb } from './connection'
import { isString, parseJsonArray } from './json'
import { getAllTracks, type Track } from './tracks'

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
    for (const tag of parseJsonArray(tags, isString)) {
      tagCount.set(tag, (tagCount.get(tag) ?? 0) + cnt)
    }
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

// 直近 limit 件の履歴での順位（同じtrackは最新の順位を採用）
async function getRecentTrackRanks(limit: number): Promise<Map<number, number>> {
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
      // generateRecommend は順位を RECENT_LIMIT で割るので、件数を揃える
      getRecentTrackRanks(RECENT_LIMIT),
    ])

  return generateRecommend({
    allTracks,
    playCounts,
    historyTagCounts,
    historyArtistCounts,
    recentRanks,
  })
}
