import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTopListening } from './history'
import type { TrackRow } from './tracks'

const select = vi.hoisted(() => vi.fn())
vi.mock('./connection', () => ({ getDb: async () => ({ select }) }))

describe('getTopListening', () => {
  const row = (id: number, playCount: number, tags: string[] = []): TrackRow & { play_count: number } => ({
    id, file_hash: `h${id}`, path: `/${id}.mp3`, title: `t${id}`, artist: 'a', album: null,
    tags: JSON.stringify(tags), duration_ms: null, lufs: null, trailing_silence_ms: null,
    scanned_at: 0, play_count: playCount,
  })

  beforeEach(() => {
    select.mockReset()
  })

  it('曲は上位5件を Track と count の組で返す', async () => {
    select.mockResolvedValue([6, 5, 4, 3, 2, 1].map(n => row(n, n, ['静'])))

    const { tracks } = await getTopListening()

    expect(tracks.map(t => t.count)).toEqual([6, 5, 4, 3, 2])
    expect(tracks[0].track.tags).toEqual(['静'])
    expect(tracks[0].track).not.toHaveProperty('play_count')
  })

  it('タグは上位5曲より下の曲も含めて再生回数を合計する', async () => {
    select.mockResolvedValue([
      row(1, 10, ['静', '明']),
      row(2, 9),
      row(3, 8),
      row(4, 7),
      row(5, 6),
      row(6, 5, ['静']),
    ])

    const { tags } = await getTopListening()

    expect(tags).toEqual([{ tag: '静', count: 15 }, { tag: '明', count: 10 }])
  })

  it('タグは上位6件で、同数なら名前順に並べる', async () => {
    select.mockResolvedValue([
      row(1, 1, ['き', 'か', 'お', 'え', 'う', 'い', 'あ']),
      row(2, 1, ['き']),
    ])

    const { tags } = await getTopListening()

    expect(tags.map(t => t.tag)).toEqual(['き', 'あ', 'い', 'う', 'え', 'お'])
  })

  it('weeks 週間前より後の履歴だけを問い合わせる', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000)
    select.mockResolvedValue([])

    await getTopListening(2)

    expect(select.mock.calls[0][1]).toEqual([1_000_000_000_000 - 14 * 24 * 60 * 60 * 1000])
    vi.restoreAllMocks()
  })

  it('履歴がなければ空を返す', async () => {
    select.mockResolvedValue([])

    expect(await getTopListening()).toEqual({ tracks: [], tags: [] })
  })
})
