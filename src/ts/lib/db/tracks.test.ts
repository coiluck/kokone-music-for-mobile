import { beforeEach, describe, expect, it, vi } from 'vitest'
import { matchesTags, rowToTrack, searchTracks, type TrackRow } from './tracks'

const select = vi.hoisted(() => vi.fn())
vi.mock('./connection', () => ({ getDb: async () => ({ select }) }))

describe('matchesTags', () => {
  it('include を全て持つときだけ通す', () => {
    expect(matchesTags(['静', '明', 'J-POP'], ['静', '明'])).toBe(true)
    expect(matchesTags(['静'], ['静', '明'])).toBe(false)
  })

  it('exclude を一つでも持つと落とす', () => {
    expect(matchesTags(['静', '明'], ['静'], ['暗'])).toBe(true)
    expect(matchesTags(['静', '暗'], ['静'], ['暗', '激'])).toBe(false)
  })

  it('include が空なら exclude だけで判定する', () => {
    expect(matchesTags(['静'], [])).toBe(true)
    expect(matchesTags(['静'], [], ['静'])).toBe(false)
  })
})

describe('rowToTrack', () => {
  const row = (tags: string): TrackRow => ({
    id: 1, file_hash: 'h', path: '/a.mp3', title: 't', artist: 'a', album: null, tags,
    duration_ms: null, lufs: null, trailing_silence_ms: null, scanned_at: 0,
  })

  it('tags の JSON を配列に戻す', () => {
    expect(rowToTrack(row('["静","明"]')).tags).toEqual(['静', '明'])
  })

  it('壊れた JSON や文字列以外の要素は捨てる', () => {
    expect(rowToTrack(row('not json')).tags).toEqual([])
    expect(rowToTrack(row('["静", 1, null]')).tags).toEqual(['静'])
  })
})

describe('searchTracks', () => {
  const row = (id: number, tags: string[]): TrackRow => ({
    id, file_hash: 'h', path: '/a.mp3', title: 't', artist: 'a', album: null, tags: JSON.stringify(tags),
    duration_ms: null, lufs: null, trailing_silence_ms: null, scanned_at: 0,
  })

  beforeEach(() => {
    select.mockReset()
    select.mockResolvedValue([row(1, ['静', '明']), row(2, ['静']), row(3, [])])
  })

  it('前後の空白を除いて title / artist / album を部分一致で探す', async () => {
    await searchTracks('  foo  ')
    const [sql, params] = select.mock.calls[0]
    expect(sql).toContain('title LIKE $1 OR artist LIKE $1 OR album LIKE $1')
    expect(params).toEqual(['%foo%'])
  })

  it('空白だけの query は全件を対象にする', async () => {
    const result = await searchTracks('   ')
    expect(select.mock.calls[0]).toHaveLength(1)
    expect(String(select.mock.calls[0][0])).not.toContain('LIKE')
    expect(result.map(t => t.id)).toEqual([1, 2, 3])
  })

  it('tags は全てを持つ曲だけに絞る', async () => {
    const result = await searchTracks('', ['静', '明'])
    expect(result.map(t => t.id)).toEqual([1])
  })

  it('query と tags を同時に使える', async () => {
    const result = await searchTracks('foo', ['静'])
    expect(select.mock.calls[0][1]).toEqual(['%foo%'])
    expect(result.map(t => t.id)).toEqual([1, 2])
  })
})
