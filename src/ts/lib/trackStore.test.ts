import { describe, expect, it } from 'vitest'
import type { Track } from './db'
import { sortByTitle } from './trackStore'

function track(id: number, title: string): Track {
  return {
    id,
    file_hash: `hash${id}`,
    path: `/music/${id}.mp3`,
    title,
    artist: 'artist',
    album: null,
    tags: [],
    duration_ms: null,
    lufs: null,
    trailing_silence_ms: null,
    scanned_at: 0,
  }
}

const titles = (tracks: Track[]) => tracks.map(t => t.title)

describe('sortByTitle', () => {
  it('タイトルの昇順に並べる', () => {
    const input = [track(1, 'う'), track(2, 'あ'), track(3, 'い')]
    expect(titles(sortByTitle(input))).toEqual(['あ', 'い', 'う'])
  })

  it('数字は数値として比較する（numeric: true）', () => {
    const input = [track(1, '曲10'), track(2, '曲2'), track(3, '曲1')]
    expect(titles(sortByTitle(input))).toEqual(['曲1', '曲2', '曲10'])
  })

  it('入力配列を破壊しない', () => {
    const input = [track(1, 'う'), track(2, 'あ')]
    const result = sortByTitle(input)
    expect(titles(input)).toEqual(['う', 'あ'])
    expect(result).not.toBe(input)
  })

  it('空配列は空配列を返す', () => {
    expect(sortByTitle([])).toEqual([])
  })
})
