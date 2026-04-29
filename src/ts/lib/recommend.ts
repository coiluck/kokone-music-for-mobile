import type { Track } from './db'

const WEIGHT = {
  playCount: 2,
  tagCount: 6,
  artistCount: 3,
  addedAt: 3,
  notRecentlyPlayed: 4,
}

const RECENT_LIMIT = 200

export interface RecommendInput {
  allTracks: Track[]
  playCounts: Map<number, number>           // track_id -> 再生回数
  historyTagCounts: Map<string, number>     // tag -> 履歴上の出現回数
  historyArtistCounts: Map<string, number>  // artist -> 履歴上の出現回数
  recentRanks: Map<number, number>          // track_id -> 直近200件中の順位(0始まり)
}

// Min-Max正規化（max === min のときは全て0を返す）
function normalizeMinMax(values: Map<number, number>): Map<number, number> {
  if (values.size === 0) return new Map()
  const arr = [...values.values()]
  const min = Math.min(...arr)
  const max = Math.max(...arr)
  const range = max - min
  if (range === 0) return new Map([...values].map(([id]) => [id, 0]))
  return new Map([...values].map(([id, v]) => [id, (v - min) / range]))
}

export function generateRecommend(input: RecommendInput): Track[] {
  const { allTracks, playCounts, historyTagCounts, historyArtistCounts, recentRanks } = input
  if (allTracks.length === 0) return []

  // --- 各曲のtagスコア = その曲が持つtagsの履歴上の合計出現回数 ---
  const tagScoreRaw = new Map<number, number>()
  for (const track of allTracks) {
    const sum = track.tags.reduce(
      (s, tag) => s + (historyTagCounts.get(tag) ?? 0),
      0
    )
    tagScoreRaw.set(track.id, sum)
  }

  // --- 各曲のartistスコア ---
  const artistScoreRaw = new Map<number, number>()
  for (const track of allTracks) {
    artistScoreRaw.set(track.id, historyArtistCounts.get(track.artist ?? '') ?? 0)
  }

  // --- addedAt: scanned_at ---
  const addedAtRaw = new Map<number, number>()
  for (const track of allTracks) {
    addedAtRaw.set(track.id, track.scanned_at)
  }

  // --- notRecentlyPlayed (0〜1にスケール) ---
  // 直近200に入っていない → 1.0
  // 直近200に入っている → 順位 / (LIMIT - 1)、つまり0.0(最も最近)〜1.0(200件中で古め)
  const notRecentRaw = new Map<number, number>()
  for (const track of allTracks) {
    if (recentRanks.has(track.id)) {
      const rank = recentRanks.get(track.id)!
      notRecentRaw.set(track.id, rank / (RECENT_LIMIT - 1))
    } else {
      notRecentRaw.set(track.id, 1)
    }
  }

  // --- 正規化（playCount/tag/artist/addedAtはMin-Maxへ統一） ---
  const normPlayCount = normalizeMinMax(playCounts)
  const normTagScore  = normalizeMinMax(tagScoreRaw)
  const normArtist    = normalizeMinMax(artistScoreRaw)
  const normAddedAt   = normalizeMinMax(addedAtRaw)
  // notRecentRaw は既に 0〜1 スケールなので正規化不要

  // --- 合算 ---
  const scored = allTracks.map(track => {
    const id = track.id
    const score =
      (normPlayCount.get(id) ?? 0) * WEIGHT.playCount +
      (normTagScore.get(id)  ?? 0) * WEIGHT.tagCount +
      (normArtist.get(id)    ?? 0) * WEIGHT.artistCount +
      (normAddedAt.get(id)   ?? 0) * WEIGHT.addedAt +
      (notRecentRaw.get(id)  ?? 1) * WEIGHT.notRecentlyPlayed
    return { track, score }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 100)
    .map(s => s.track)
}