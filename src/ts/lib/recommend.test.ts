import { describe, expect, it } from 'vitest'
import type { Track } from './db'
import { generateRecommend, type RecommendInput } from './recommend'

function track(id: number, over: Partial<Track> = {}): Track {
  return {
    id,
    file_hash: `hash${id}`,
    path: `/music/${id}.mp3`,
    title: `title${id}`,
    artist: 'artist',
    album: null,
    tags: [],
    duration_ms: null,
    lufs: null,
    trailing_silence_ms: null,
    scanned_at: 0,
    ...over,
  }
}

// 指定しなかった要素は「全曲で同じ値」になり、スコアに差が出ない
function input(allTracks: Track[], over: Partial<RecommendInput> = {}): RecommendInput {
  return {
    allTracks,
    playCounts: new Map(),
    historyTagCounts: new Map(),
    historyArtistCounts: new Map(),
    recentRanks: new Map(),
    ...over,
  }
}

const ids = (tracks: Track[]) => tracks.map(t => t.id)

describe('generateRecommend', () => {
  it('曲が無ければ空配列', () => {
    expect(generateRecommend(input([]))).toEqual([])
  })

  it('最大100件までに絞る', () => {
    const tracks = Array.from({ length: 150 }, (_, i) => track(i + 1))
    expect(generateRecommend(input(tracks))).toHaveLength(100)
  })

  it('履歴に多いタグを持つ曲を上位にする', () => {
    const tracks = [track(1, { tags: [] }), track(2, { tags: ['rock'] })]
    const result = generateRecommend(
      input(tracks, { historyTagCounts: new Map([['rock', 10]]) })
    )
    expect(ids(result)).toEqual([2, 1])
  })

  it('履歴に多いアーティストの曲を上位にする', () => {
    const tracks = [track(1, { artist: 'A' }), track(2, { artist: 'B' })]
    const result = generateRecommend(
      input(tracks, { historyArtistCounts: new Map([['B', 5]]) })
    )
    expect(ids(result)).toEqual([2, 1])
  })

  it('再生回数が多い曲を上位にする', () => {
    const tracks = [track(1), track(2)]
    const result = generateRecommend(
      input(tracks, { playCounts: new Map([[1, 0], [2, 8]]) })
    )
    expect(ids(result)).toEqual([2, 1])
  })

  it('新しく追加された曲を上位にする', () => {
    const tracks = [track(1, { scanned_at: 100 }), track(2, { scanned_at: 200 })]
    expect(ids(generateRecommend(input(tracks)))).toEqual([2, 1])
  })

  it('直近に再生した曲を下位にする', () => {
    const tracks = [track(1), track(2)]
    // 1 は直近再生の先頭、2 は直近200件に無い
    const result = generateRecommend(input(tracks, { recentRanks: new Map([[1, 0]]) }))
    expect(ids(result)).toEqual([2, 1])
  })

  it('スコアの要素が全曲同じ値なら順位に影響しない', () => {
    const tracks = [track(1, { scanned_at: 500 }), track(2, { scanned_at: 500 })]
    // 再生回数が同じ = Min-Max の分母が0 → 両方0扱いになり、タグ差だけで決まる
    const result = generateRecommend(
      input(tracks, {
        playCounts: new Map([[1, 3], [2, 3]]),
        historyTagCounts: new Map([['pop', 4]]),
      })
    )
    expect(ids(result)).toEqual([1, 2])

    const withTag = generateRecommend(
      input([track(1, { scanned_at: 500 }), track(2, { scanned_at: 500, tags: ['pop'] })], {
        playCounts: new Map([[1, 3], [2, 3]]),
        historyTagCounts: new Map([['pop', 4]]),
      })
    )
    expect(ids(withTag)).toEqual([2, 1])
  })
})
