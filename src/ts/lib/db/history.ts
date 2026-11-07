import { getDb } from './connection'
import { rowToTrack, type Track, type TrackRow } from './tracks'

export async function getHistory(): Promise<Track[]> {
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

// 再生開始時に history 行を作り、その rowid を返す
// rowid は updateListenedMs() の引数として使うから必要
export async function startPlay(trackId: number): Promise<number> {
  const db = await getDb()
  const nowUNIX = Date.now()
  const result = await db.execute(
    'INSERT INTO history (track_id, played_at, listened_ms) VALUES ($1, $2, 0)',
    [trackId, nowUNIX]
  )
  return result.lastInsertId as number
}

// 再生セッションの累積リスニング時間 (ms) を history 行に反映
// 再生中は定期的に、曲の切替・停止時には確定で呼ばれる
export async function updateListenedMs(historyId: number, listenedMs: number): Promise<void> {
  const db = await getDb()
  await db.execute(
    'UPDATE history SET listened_ms = $1 WHERE rowid = $2',
    [Math.round(listenedMs), historyId]
  )
}

// ここから統計用

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

const TOP_TRACK_LIMIT = 5
const TOP_TAG_LIMIT = 6

export interface TopTrack {
  track: Track
  count: number // 再生回数
}

export interface TopTag {
  tag: string
  count: number // このタグを持つ曲の再生回数の合計
}

export interface TopListening {
  tracks: TopTrack[]
  tags: TopTag[]
}

// 直近 weeks 週間でよく聴いた曲とタグ
// タグは上位の曲だけでなく、期間内に再生した全曲から集計する
export async function getTopListening(weeks = 4): Promise<TopListening> {
  const db = await getDb()
  const since = Date.now() - weeks * 7 * 24 * 60 * 60 * 1000
  const rows = await db.select<(TrackRow & { play_count: number })[]>(
    `SELECT t.*, COUNT(*) AS play_count
     FROM history h
     INNER JOIN tracks t ON t.id = h.track_id
     WHERE h.played_at >= $1
     GROUP BY t.id
     ORDER BY play_count DESC, MAX(h.played_at) DESC`,
    [since]
  )
  const played = rows.map(({ play_count, ...row }) => ({
    track: rowToTrack(row),
    count: play_count,
  }))

  const tagCounts = new Map<string, number>()
  for (const { track, count } of played) {
    for (const tag of track.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + count)
    }
  }
  const tags = [...tagCounts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'))

  return {
    tracks: played.slice(0, TOP_TRACK_LIMIT),
    tags: tags.slice(0, TOP_TAG_LIMIT),
  }
}
