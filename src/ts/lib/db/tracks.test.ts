import { describe, expect, it } from 'vitest'
import { matchesTags, rowToTrack, type TrackRow } from './tracks'

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
